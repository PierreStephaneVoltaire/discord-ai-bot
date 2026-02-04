import { createClient, type RedisClientType } from 'redis';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';

const log = createLogger('REDIS');

let redisClient: RedisClientType | null = null;
let isConnected = false;

/**
 * Initialize and return the Redis client
 * Returns null if Redis is disabled or unavailable
 */
export async function getRedisClient(): Promise<RedisClientType | null> {
  const config = getConfig();

  if (!config.REDIS_ENABLED) {
    return null;
  }

  if (!config.REDIS_URL) {
    log.warn('REDIS_URL not configured, Redis operations will be skipped');
    return null;
  }

  if (!redisClient) {
    log.info('Initializing Redis client');

    redisClient = createClient({
      url: config.REDIS_URL,
      socket: {
        reconnectStrategy: (retries: number): number => {
          const delay = Math.min(retries * 100, 3000);
          log.warn(`Redis reconnect attempt ${retries}, delay ${delay}ms`);
          return delay;
        },
        connectTimeout: 10000,
        keepAlive: 1000,
      },
    });

    redisClient.on('error', (err: Error) => {
      log.error('Redis connection error', { error: err.message });
      isConnected = false;
    });

    redisClient.on('connect', () => {
      log.info('Redis connected');
      isConnected = true;
    });

    redisClient.on('disconnect', () => {
      log.warn('Redis disconnected');
      isConnected = false;
    });

    redisClient.on('reconnecting', () => {
      log.info('Redis reconnecting...');
    });

    try {
      await redisClient.connect();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('Failed to connect to Redis', { error: errorMessage });
      isConnected = false;
      // Don't throw - graceful degradation
      return null;
    }
  }

  return isConnected ? redisClient : null;
}

/**
 * Check if Redis is currently available
 */
export function isRedisAvailable(): boolean {
  return isConnected && redisClient !== null;
}

/**
 * Close the Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    log.info('Closing Redis connection');
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
  }
}

/**
 * Execute a Redis pipeline operation
 * Returns null if Redis is unavailable
 */
export async function executePipeline<T>(
  operations: (client: RedisClientType) => Promise<T>
): Promise<T | null> {
  const client = await getRedisClient();

  if (!client) {
    return null;
  }

  try {
    return await operations(client);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Redis pipeline operation failed', { error: errorMessage });
    return null;
  }
}

/**
 * Helper to safely execute Redis operations with fallback
 */
export async function withRedisFallback<T>(
  redisOperation: (client: RedisClientType) => Promise<T>,
  fallbackOperation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const client = await getRedisClient();

  if (!client) {
    log.debug(`Redis unavailable, using fallback for ${operationName}`);
    return fallbackOperation();
  }

  try {
    const startTime = Date.now();
    const result = await redisOperation(client);
    const elapsedMs = Date.now() - startTime;
    log.debug(`Redis ${operationName} completed in ${elapsedMs}ms`);
    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.warn(`Redis ${operationName} failed, using fallback`, { error: errorMessage });
    return fallbackOperation();
  }
}

// Re-export types
export type { ThreadState, SessionCache } from './types';

// Re-export operations
export {
  acquireLock,
  releaseLock,
  refreshLock,
  checkLock,
  setAbortFlag,
  checkAbortFlag,
  clearAbortFlag,
} from './locks';

export {
  updateThreadState,
  getThreadState,
  cacheSession,
  getCachedSession,
  deleteCachedSession,
  updateTurnState,
} from './state';
