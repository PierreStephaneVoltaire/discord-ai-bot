import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDBClient } from './index';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import type { Session, SessionUpdate } from './types';

const log = createLogger('DYNAMODB:SESSIONS');

export async function getSession(threadId: string): Promise<Session | null> {
  log.info(`getSession: ${threadId}`);

  const client = getDynamoDBClient();
  const config = getConfig();

  const result = await client.send(
    new GetCommand({
      TableName: config.DYNAMODB_SESSIONS_TABLE,
      Key: { thread_id: threadId },
    })
  );

  const exists = !!result.Item;
  log.info(`Session found: ${exists}`);

  if (!result.Item) {
    return null;
  }

  return result.Item as Session;
}

export async function createSession(session: Session): Promise<void> {
  log.info(`createSession: ${session.thread_id}`);

  const client = getDynamoDBClient();
  const config = getConfig();

  await client.send(
    new PutCommand({
      TableName: config.DYNAMODB_SESSIONS_TABLE,
      Item: session,
    })
  );

  log.info(`Session created successfully: ${session.thread_id}`);
}

export async function updateSession(threadId: string, updates: SessionUpdate): Promise<void> {
  log.info(`updateSession: ${threadId}`, { fields: Object.keys(updates) });

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
      TableName: config.DYNAMODB_SESSIONS_TABLE,
      Key: { thread_id: threadId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  log.info(`Session updated successfully: ${threadId}`);
}

export async function getOrCreateSession(threadId: string, branchName: string): Promise<Session> {
  log.info(`getOrCreateSession: ${threadId}`);

  let session = await getSession(threadId);

  if (!session) {
    log.info(`Session not found, creating new session`);
    session = {
      thread_id: threadId,
      branch_name: branchName,
      topic_summary: '',
      has_progress: false,
      confidence_score: 50,
      last_discord_timestamp: new Date().toISOString(),
      last_message: '',
      created_at: new Date().toISOString(),
      sub_topics: {},
    };

    await createSession(session);
  }

  return session;
}
