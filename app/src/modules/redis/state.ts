import type { RedisClientType } from 'redis';
import { getRedisClient, withRedisFallback } from './index';
import { createLogger } from '../../utils/logger';
import type { ThreadState, SessionCache } from './types';
import { getSession, updateSession } from '../dynamodb/sessions';

const log = createLogger('REDIS:STATE');

const THREAD_KEY_PREFIX = 'thread:';
const SESSION_KEY_PREFIX = 'session:';
const THREAD_TTL_SECONDS = 3600; // 1 hour
const SESSION_TTL_SECONDS = 3600; // 1 hour

/**
 * Update thread state in Redis (hot path)
 * Also fires-and-forgets to DynamoDB for durability
 */
export async function updateThreadState(
  threadId: string,
  state: Partial<ThreadState>
): Promise<void> {
  const client = await getRedisClient();

  if (client) {
    try {
      const threadKey = `${THREAD_KEY_PREFIX}${threadId}`;
      const startTime = Date.now();

      // Use pipeline for atomic multi-operation
      await client
        .multi()
        .hSet(threadKey, {
          ...state,
          updatedAt: new Date().toISOString(),
        })
        .expire(threadKey, THREAD_TTL_SECONDS)
        .exec();

      const elapsedMs = Date.now() - startTime;
      log.debug(`Thread state updated in Redis for ${threadId} (${elapsedMs}ms)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to update thread state in Redis for ${threadId}`, { error: errorMessage });
    }
  }

  // Fire-and-forget to DynamoDB for durability
  updateSession(threadId, {
    ...state,
    last_discord_timestamp: new Date().toISOString(),
  }).catch((error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to update session in DynamoDB for ${threadId}`, { error: errorMessage });
  });
}

/**
 * Get thread state from Redis (hot path)
 * Falls back to DynamoDB if Redis unavailable or key missing
 */
export async function getThreadState(threadId: string): Promise<ThreadState | null> {
  return withRedisFallback(
    async (client) => {
      const threadKey = `${THREAD_KEY_PREFIX}${threadId}`;
      const state = await client.hGetAll(threadKey);

      if (Object.keys(state).length === 0) {
        log.debug(`Thread state not found in Redis for ${threadId}`);
        return null;
      }

      return {
        state: state.state || 'idle',
        confidence: parseInt(state.confidence, 10) || 80,
        turn: parseInt(state.turn, 10) || 0,
        model: state.model || 'gemini-3-pro',
        updatedAt: state.updatedAt || new Date().toISOString(),
      };
    },
    async () => {
      // Fallback to DynamoDB
      const session = await getSession(threadId);

      if (!session) {
        return null;
      }

      return {
        state: 'idle', // Session doesn't have status field
        confidence: session.confidence_score || 80,
        turn: session.current_turn || 0,
        model: session.model || 'gemini-3-pro',
        updatedAt: session.last_discord_timestamp || new Date().toISOString(),
      };
    },
    'getThreadState'
  );
}

/**
 * Cache session data in Redis for active executions
 */
export async function cacheSession(
  threadId: string,
  sessionData: SessionCache
): Promise<void> {
  const client = await getRedisClient();

  if (!client) {
    return;
  }

  try {
    const sessionKey = `${SESSION_KEY_PREFIX}${threadId}`;

    await client
      .multi()
      .hSet(sessionKey, {
        threadId: sessionData.threadId,
        confidenceScore: String(sessionData.confidenceScore),
        currentTurn: String(sessionData.currentTurn),
        model: sessionData.model,
        agentRole: sessionData.agentRole || '',
        workspacePath: sessionData.workspacePath || '',
        s3Prefix: sessionData.s3Prefix || '',
        updatedAt: new Date().toISOString(),
      })
      .expire(sessionKey, SESSION_TTL_SECONDS)
      .exec();

    log.debug(`Session cached in Redis for ${threadId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to cache session in Redis for ${threadId}`, { error: errorMessage });
  }
}

/**
 * Get cached session from Redis
 */
export async function getCachedSession(threadId: string): Promise<SessionCache | null> {
  const client = await getRedisClient();

  if (!client) {
    return null;
  }

  try {
    const sessionKey = `${SESSION_KEY_PREFIX}${threadId}`;
    const data = await client.hGetAll(sessionKey);

    if (Object.keys(data).length === 0) {
      return null;
    }

    return {
      threadId: data.threadId,
      confidenceScore: parseInt(data.confidenceScore, 10) || 80,
      currentTurn: parseInt(data.currentTurn, 10) || 0,
      model: data.model || 'gemini-3-pro',
      agentRole: data.agentRole || undefined,
      workspacePath: data.workspacePath || undefined,
      s3Prefix: data.s3Prefix || undefined,
      updatedAt: data.updatedAt || new Date().toISOString(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to get cached session from Redis for ${threadId}`, { error: errorMessage });
    return null;
  }
}

/**
 * Delete cached session from Redis
 */
export async function deleteCachedSession(threadId: string): Promise<void> {
  const client = await getRedisClient();

  if (!client) {
    return;
  }

  try {
    const sessionKey = `${SESSION_KEY_PREFIX}${threadId}`;
    await client.del(sessionKey);
    log.debug(`Cached session deleted for ${threadId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to delete cached session for ${threadId}`, { error: errorMessage });
  }
}

/**
 * Update specific fields in thread state using pipeline
 * This is the primary pattern for per-turn updates
 */
export async function updateTurnState(
  threadId: string,
  turnNumber: number,
  confidence: number,
  model: string,
  state: string,
  executionId: string
): Promise<void> {
  const client = await getRedisClient();

  if (!client) {
    // Just update DynamoDB if Redis unavailable
    updateSession(threadId, {
      current_turn: turnNumber,
      confidence_score: confidence,
      model,
    }).catch(() => {});
    return;
  }

  try {
    const threadKey = `${THREAD_KEY_PREFIX}${threadId}`;
    const lockKey = `lock:${threadId}`;
    const startTime = Date.now();

    // Pipeline all operations together for single round-trip
    await client
      .multi()
      .hSet(threadKey, {
        state,
        confidence: String(confidence),
        turn: String(turnNumber),
        model,
        updatedAt: new Date().toISOString(),
      })
      .expire(threadKey, THREAD_TTL_SECONDS)
      .expire(lockKey, 300) // Refresh lock TTL
      .exec();

    const elapsedMs = Date.now() - startTime;
    log.debug(`Turn state updated in pipeline for ${threadId} turn ${turnNumber} (${elapsedMs}ms)`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to update turn state for ${threadId}`, { error: errorMessage });
  }
}
