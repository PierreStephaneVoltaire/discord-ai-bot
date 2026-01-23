import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from './index';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import { generateExecutionId } from '../../utils/id';
import type { Execution, ExecutionUpdate } from './types';

const log = createLogger('DYNAMODB:EXECUTIONS');

const TTL_MINUTES = 15;

export async function createExecution(
  threadId: string,
  messageId: string
): Promise<string> {
  const executionId = generateExecutionId();
  log.info(`createExecution: ${executionId} for message ${messageId}`);

  const client = getDynamoDBClient();
  const config = getConfig();

  const now = new Date();
  const ttl = Math.floor(now.getTime() / 1000) + TTL_MINUTES * 60;

  const execution: Execution = {
    execution_id: executionId,
    thread_id: threadId,
    message_id: messageId,
    status: 'pending',
    created_at: now.toISOString(),
    ttl,
  };

  await client.send(
    new PutCommand({
      TableName: config.DYNAMODB_EXECUTIONS_TABLE,
      Item: execution,
    })
  );

  log.info(`Execution created: ${executionId}`);
  return executionId;
}

export async function updateExecution(
  executionId: string,
  updates: ExecutionUpdate
): Promise<void> {
  log.info(`updateExecution: ${executionId}, status: ${updates.status || 'unchanged'}`);

  const client = getDynamoDBClient();
  const config = getConfig();

  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      updateExpressions.push(`#${key} = :${key}`);
      expressionAttributeNames[`#${key}`] = key;
      expressionAttributeValues[`:${key}`] = value;
    }
  }

  if (updateExpressions.length === 0) {
    log.info('No fields to update');
    return;
  }

  await client.send(
    new UpdateCommand({
      TableName: config.DYNAMODB_EXECUTIONS_TABLE,
      Key: { execution_id: executionId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  log.info(`Execution updated: ${executionId}`);
}

export async function getExecution(executionId: string): Promise<Execution | null> {
  log.info(`getExecution: ${executionId}`);

  const client = getDynamoDBClient();
  const config = getConfig();

  const result = await client.send(
    new GetCommand({
      TableName: config.DYNAMODB_EXECUTIONS_TABLE,
      Key: { execution_id: executionId },
    })
  );

  if (!result.Item) {
    log.info(`Execution not found: ${executionId}`);
    return null;
  }

  return result.Item as Execution;
}

export async function markExecutionProcessing(executionId: string): Promise<void> {
  await updateExecution(executionId, { status: 'processing' });
}

export async function markExecutionCompleted(
  executionId: string,
  modelUsed: string
): Promise<void> {
  await updateExecution(executionId, {
    status: 'completed',
    completed_at: new Date().toISOString(),
    model_used: modelUsed,
  });
}

export async function markExecutionFailed(
  executionId: string,
  error: string
): Promise<void> {
  await updateExecution(executionId, {
    status: 'failed',
    completed_at: new Date().toISOString(),
    error,
  });
}
