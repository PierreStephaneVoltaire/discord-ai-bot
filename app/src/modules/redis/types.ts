/**
 * Redis module type definitions
 */

export interface ThreadState {
  state: string;
  confidence: number;
  turn: number;
  model: string;
  updatedAt: string;
}

export interface SessionCache {
  threadId: string;
  confidenceScore: number;
  currentTurn: number;
  model: string;
  agentRole?: string;
  workspacePath?: string;
  s3Prefix?: string;
  updatedAt: string;
}

export interface ExecutionLock {
  threadId: string;
  executionId: string;
  startedAt: string;
}

export interface RedisOperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fromCache: boolean;
}
