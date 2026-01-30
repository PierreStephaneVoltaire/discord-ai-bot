import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from '../dynamodb/index';
import { createLogger } from '../../utils/logger';
import type { ExecutionTurn, AgentRole } from '../litellm/types';

const log = createLogger('AGENTIC:LOGGING');

const TABLE_NAME = process.env.DYNAMODB_EXECUTIONS_TABLE || 'discord_executions';

export interface ExecutionLog {
  execution_id: string;     // Unique ID for this execution log entry
  thread_id: string;        // Discord thread ID
  turn: number;
  model: string;
  agentRole: AgentRole;
  confidence: number;
  status: 'continue' | 'complete' | 'stuck' | 'aborted';
  toolCalls: Array<{
    tool: string;
    input: object;
    output: object;
    success: boolean;
    durationMs: number;
  }>;
  errorMessage?: string;
  fileChanges?: string[];
  timestamp: string;        // ISO format
  ttl: number;              // Auto-expire after 30 days
}

/**
 * Logs a turn execution to DynamoDB
 */
export async function logTurnToDb(params: {
  threadId: string;
  turn: number;
  model: string;
  agentRole: AgentRole;
  confidence: number;
  status: ExecutionLog['status'];
  toolCalls?: ExecutionLog['toolCalls'];
  errorMessage?: string;
  fileChanges?: string[];
}): Promise<void> {
  try {
    const docClient = getDynamoDBClient();
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + (30 * 24 * 60 * 60); // 30 days

    // Generate execution_id as threadId-timestamp-turn
    const execution_id = `${params.threadId}-${now.getTime()}-turn${params.turn}`;

    const logEntry = {
      execution_id,
      thread_id: params.threadId,
      turn: params.turn,
      model: params.model,
      agentRole: params.agentRole,
      confidence: params.confidence,
      status: params.status,
      toolCalls: params.toolCalls || [],
      errorMessage: params.errorMessage,
      fileChanges: params.fileChanges,
      timestamp: now.toISOString(),
      ttl,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: logEntry,
      })
    );

    log.debug(`Logged turn ${params.turn} for thread ${params.threadId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to log turn to DynamoDB: ${errorMessage}`);
    // Don't throw - logging failures shouldn't break execution
  }
}

/**
 * Logs an execution start event
 */
export async function logExecutionStart(params: {
  threadId: string;
  taskType: string;
  agentRole: AgentRole;
  model: string;
}): Promise<void> {
  try {
    const docClient = getDynamoDBClient();
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + (30 * 24 * 60 * 60);

    // Generate execution_id as threadId-timestamp-start
    const execution_id = `${params.threadId}-${now.getTime()}-start`;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          execution_id,
          thread_id: params.threadId,
          eventType: 'execution_started',
          taskType: params.taskType,
          agentRole: params.agentRole,
          model: params.model,
          timestamp: now.toISOString(),
          ttl,
        },
      })
    );

    log.info(`Logged execution start for thread ${params.threadId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to log execution start: ${errorMessage}`);
  }
}

/**
 * Logs an execution completion event
 */
export async function logExecutionComplete(params: {
  threadId: string;
  totalTurns: number;
  finalStatus: string;
  success: boolean;
}): Promise<void> {
  try {
    const docClient = getDynamoDBClient();
    const now = new Date();
    const ttl = Math.floor(now.getTime() / 1000) + (30 * 24 * 60 * 60);

    // Generate execution_id as threadId-timestamp-end
    const execution_id = `${params.threadId}-${now.getTime()}-end`;

    await docClient.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          execution_id,
          thread_id: params.threadId,
          eventType: 'execution_completed',
          totalTurns: params.totalTurns,
          finalStatus: params.finalStatus,
          success: params.success,
          timestamp: now.toISOString(),
          ttl,
        },
      })
    );

    log.info(`Logged execution completion for thread ${params.threadId}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to log execution completion: ${errorMessage}`);
  }
}
