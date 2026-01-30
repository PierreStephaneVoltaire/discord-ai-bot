import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from './index';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import type { EscalationEvent } from './types';

const log = createLogger('DYNAMODB:QUERIES');

export interface ExecutionLogEntry {
  execution_id: string;
  thread_id: string;
  timestamp: string;
  eventType?: string;
  taskType?: string;
  agentRole?: string;
  model?: string;
  status?: string;
  finalStatus?: string;
  totalTurns?: number;
  confidence?: number;
  success?: boolean;
  error?: string;
  turn?: number;
}

export interface ExecutionSummary {
  executionId: string;
  timestamp: string;
  taskSummary: string;
  finalModel: string;
  turnCount: number;
  outcome: 'success' | 'failed' | 'aborted' | 'unknown';
  confidenceScore: number | null;
}

export interface ConfidenceHistoryEntry {
  timestamp: string;
  confidence: number;
  status: string;
}

/**
 * Query execution logs for a thread
 */
export async function queryExecutionLogs(
  threadId: string,
  limit: number = 10
): Promise<ExecutionLogEntry[]> {
  const client = getDynamoDBClient();
  const config = getConfig();

  log.info(`Querying execution logs for thread ${threadId}, limit ${limit}`);

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: config.DYNAMODB_EXECUTIONS_TABLE,
        IndexName: 'thread_id-index',
        KeyConditionExpression: 'thread_id = :threadId',
        ExpressionAttributeValues: {
          ':threadId': threadId,
        },
        ScanIndexForward: false, // Most recent first
        Limit: limit * 3, // Get more to filter and group
      })
    );

    const items = (result.Items || []) as ExecutionLogEntry[];
    log.info(`Found ${items.length} execution log entries`);
    return items;
  } catch (error) {
    log.error(`Failed to query execution logs for thread ${threadId}`, { error: String(error) });
    throw error;
  }
}

/**
 * Get execution summaries for display in /logs command
 */
export async function getExecutionSummaries(
  threadId: string,
  count: number = 5
): Promise<ExecutionSummary[]> {
  const logs = await queryExecutionLogs(threadId, count * 5);

  // Group by execution and get the most significant event for each
  const executionMap = new Map<string, ExecutionLogEntry[]>();

  for (const log of logs) {
    const baseId = log.execution_id.split('-').slice(0, 2).join('-');
    if (!executionMap.has(baseId)) {
      executionMap.set(baseId, []);
    }
    executionMap.get(baseId)!.push(log);
  }

  const summaries: ExecutionSummary[] = [];

  for (const [, entries] of executionMap) {
    // Sort by timestamp
    entries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const startEvent = entries.find(e => e.eventType === 'execution_started');
    const endEvent = entries.find(e => e.eventType === 'execution_completed');
    const lastTurn = entries.find(e => e.turn !== undefined);

    if (startEvent || endEvent) {
      const outcome: ExecutionSummary['outcome'] = endEvent
        ? endEvent.success
          ? 'success'
          : 'failed'
        : entries.some(e => e.status === 'aborted')
        ? 'aborted'
        : 'unknown';

      summaries.push({
        executionId: entries[0].execution_id,
        timestamp: entries[0].timestamp,
        taskSummary: startEvent?.taskType || 'Unknown task',
        finalModel: endEvent?.model || lastTurn?.model || 'Unknown',
        turnCount: endEvent?.totalTurns || lastTurn?.turn || 0,
        outcome,
        confidenceScore: lastTurn?.confidence || null,
      });
    }
  }

  // Sort by timestamp descending and limit
  summaries.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return summaries.slice(0, count);
}

/**
 * Get confidence history for a thread
 */
export async function getConfidenceHistory(
  threadId: string,
  limit: number = 10
): Promise<ConfidenceHistoryEntry[]> {
  const logs = await queryExecutionLogs(threadId, limit * 2);

  // Filter for turn-based entries with confidence
  const entries: ConfidenceHistoryEntry[] = logs
    .filter(log => log.confidence !== undefined && log.turn !== undefined)
    .map(log => ({
      timestamp: log.timestamp,
      confidence: log.confidence!,
      status: log.status || 'unknown',
    }));

  // Sort by timestamp ascending for trend analysis
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return entries.slice(-limit);
}

/**
 * Get escalation history for a thread from session
 */
export function getEscalationHistory(session: { escalations?: EscalationEvent[] } | null): EscalationEvent[] {
  if (!session?.escalations || session.escalations.length === 0) {
    return [];
  }

  // Sort by timestamp descending
  return [...session.escalations].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Get outcome emoji
 */
export function getOutcomeEmoji(outcome: ExecutionSummary['outcome']): string {
  switch (outcome) {
    case 'success':
      return '✅';
    case 'failed':
      return '❌';
    case 'aborted':
      return '🛑';
    default:
      return '❓';
  }
}
