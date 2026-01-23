import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:LOCK');

export interface ExecutionLock {
  threadId: string;
  abort: boolean;
  currentTurn: number;
  startedAt: Date;
}

// In-memory store of active execution locks
// In production, this could be backed by Redis for distributed scenarios
const executionLocks = new Map<string, ExecutionLock>();

/**
 * Creates a new execution lock for a thread
 */
export function createLock(threadId: string): ExecutionLock {
  const lock: ExecutionLock = {
    threadId,
    abort: false,
    currentTurn: 0,
    startedAt: new Date(),
  };
  
  executionLocks.set(threadId, lock);
  log.info(`Created execution lock for thread ${threadId}`);
  
  return lock;
}

/**
 * Gets an existing lock for a thread
 */
export function getLock(threadId: string): ExecutionLock | undefined {
  return executionLocks.get(threadId);
}

/**
 * Checks if a thread has an active lock
 */
export function hasActiveLock(threadId: string): boolean {
  return executionLocks.has(threadId);
}

/**
 * Updates the current turn for a lock
 */
export function updateLockTurn(threadId: string, turn: number): void {
  const lock = executionLocks.get(threadId);
  if (lock) {
    lock.currentTurn = turn;
  }
}

/**
 * Sets the abort flag on a lock
 */
export function abortLock(threadId: string): void {
  const lock = executionLocks.get(threadId);
  if (lock) {
    lock.abort = true;
    log.warn(`Abort flag set for thread ${threadId}`);
  }
}

/**
 * Releases a lock
 */
export function releaseLock(threadId: string): void {
  const lock = executionLocks.get(threadId);
  if (lock) {
    const duration = Date.now() - lock.startedAt.getTime();
    log.info(`Released execution lock for thread ${threadId} (duration: ${duration}ms, turns: ${lock.currentTurn})`);
    executionLocks.delete(threadId);
  }
}

/**
 * Gets all active locks (for debugging)
 */
export function getAllLocks(): ExecutionLock[] {
  return Array.from(executionLocks.values());
}

/**
 * Checks if a lock has been aborted
 */
export function isAborted(threadId: string): boolean {
  const lock = executionLocks.get(threadId);
  return lock?.abort ?? false;
}
