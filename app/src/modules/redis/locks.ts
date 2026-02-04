import type { RedisClientType } from 'redis';
import { getRedisClient, withRedisFallback } from './index';
import { createLogger } from '../../utils/logger';
import {
  createLock as createInMemoryLock,
  releaseLock as releaseInMemoryLock,
  hasActiveLock,
  abortLock,
} from '../agentic/lock';

const log = createLogger('REDIS:LOCKS');

const LOCK_TTL_SECONDS = 300; // 5 minutes
const LOCK_KEY_PREFIX = 'lock:';

/**
 * Acquire a distributed lock for a thread
 * Uses Redis SET NX for atomic acquisition with TTL
 * Falls back to in-memory lock if Redis unavailable
 */
export async function acquireLock(
  threadId: string,
  executionId: string
): Promise<boolean> {
  return withRedisFallback(
    async (client) => {
      const lockKey = `${LOCK_KEY_PREFIX}${threadId}`;

      // Atomic SET with NX (only if not exists) and EX (TTL)
      const result = await client.set(lockKey, executionId, {
        NX: true,
        EX: LOCK_TTL_SECONDS,
      });

      const acquired = result === 'OK';

      if (acquired) {
        log.info(`Lock acquired for thread ${threadId}`, { executionId });
      } else {
        log.debug(`Lock not acquired for thread ${threadId} - already locked`);
      }

      return acquired;
    },
    async () => {
      // Fallback: check in-memory lock
      if (hasActiveLock(threadId)) {
        log.debug(`In-memory lock exists for thread ${threadId}`);
        return false;
      }

      // Create in-memory lock
      createInMemoryLock(threadId);
      log.info(`In-memory lock created for thread ${threadId}`, { executionId });
      return true;
    },
    'acquireLock'
  );
}

/**
 * Release a distributed lock
 */
export async function releaseLock(threadId: string): Promise<void> {
  const client = await getRedisClient();

  if (client) {
    try {
      const lockKey = `${LOCK_KEY_PREFIX}${threadId}`;
      await client.del(lockKey);
      log.info(`Redis lock released for thread ${threadId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to release Redis lock for ${threadId}`, { error: errorMessage });
    }
  }

  // Always release in-memory lock for consistency
  releaseInMemoryLock(threadId);
}

/**
 * Refresh the TTL on an existing lock
 * Only refreshes if we still own the lock
 */
export async function refreshLock(
  threadId: string,
  executionId: string
): Promise<boolean> {
  const client = await getRedisClient();

  if (!client) {
    // In-memory locks don't need refresh
    return hasActiveLock(threadId);
  }

  try {
    const lockKey = `${LOCK_KEY_PREFIX}${threadId}`;

    // Check if we still own the lock
    const currentOwner = await client.get(lockKey);

    if (currentOwner !== executionId) {
      log.warn(`Lock ownership changed for thread ${threadId}`, {
        expected: executionId,
        actual: currentOwner,
      });
      return false;
    }

    // Refresh TTL
    await client.expire(lockKey, LOCK_TTL_SECONDS);
    log.debug(`Lock refreshed for thread ${threadId}`);
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to refresh lock for ${threadId}`, { error: errorMessage });
    return false;
  }
}

/**
 * Check if a lock exists for a thread
 */
export async function checkLock(threadId: string): Promise<string | null> {
  const client = await getRedisClient();

  if (client) {
    try {
      const lockKey = `${LOCK_KEY_PREFIX}${threadId}`;
      return await client.get(lockKey);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to check lock for ${threadId}`, { error: errorMessage });
    }
  }

  // Fallback to in-memory
  return hasActiveLock(threadId) ? 'in-memory' : null;
}

/**
 * Set abort flag on a lock
 */
export async function setAbortFlag(threadId: string): Promise<void> {
  const client = await getRedisClient();

  if (client) {
    try {
      const abortKey = `abort:${threadId}`;
      await client.set(abortKey, '1', { EX: 600 }); // 10 minute TTL
      log.info(`Abort flag set in Redis for thread ${threadId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to set abort flag in Redis for ${threadId}`, { error: errorMessage });
    }
  }

  // Always set in-memory abort for immediate effect
  abortLock(threadId);
}

/**
 * Check if abort flag is set
 */
export async function checkAbortFlag(threadId: string): Promise<boolean> {
  const client = await getRedisClient();

  if (client) {
    try {
      const abortKey = `abort:${threadId}`;
      const flag = await client.get(abortKey);
      return flag === '1';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to check abort flag for ${threadId}`, { error: errorMessage });
    }
  }

  // Fallback to in-memory
  const { isAborted } = await import('../agentic/lock');
  return isAborted(threadId);
}

/**
 * Clear abort flag
 */
export async function clearAbortFlag(threadId: string): Promise<void> {
  const client = await getRedisClient();

  if (client) {
    try {
      const abortKey = `abort:${threadId}`;
      await client.del(abortKey);
      log.debug(`Abort flag cleared in Redis for thread ${threadId}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to clear abort flag for ${threadId}`, { error: errorMessage });
    }
  }
}
