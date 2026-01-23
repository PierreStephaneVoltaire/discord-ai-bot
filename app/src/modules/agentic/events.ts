import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:EVENTS');

const QUEUE_URL = process.env.AGENTIC_EVENTS_QUEUE_URL;

export type AgenticEvent =
  | { type: 'execution_started'; threadId: string; taskType: string; agentRole: string; }
  | { type: 'turn_completed'; threadId: string; turn: number; confidence: number; status: string; }
  | { type: 'model_escalated'; threadId: string; from: string; to: string; reason: string; }
  | { type: 'execution_completed'; threadId: string; totalTurns: number; finalStatus: string; }
  | { type: 'execution_aborted'; threadId: string; reason: 'user_stop' | 'max_turns' | 'stuck'; }
  | { type: 'commit_created'; threadId: string; branch: string; commitHash: string; }
  | { type: 'branch_merged'; threadId: string; branch: string; }
  | { type: 'branch_rejected'; threadId: string; branch: string; };

let sqsClient: SQSClient | null = null;

function getSqsClient(): SQSClient {
  if (!sqsClient) {
    sqsClient = new SQSClient({});
  }
  return sqsClient;
}

/**
 * Emits an event to the SQS queue for external observability
 */
export async function emitEvent(event: AgenticEvent): Promise<void> {
  if (!QUEUE_URL) {
    log.debug('AGENTIC_EVENTS_QUEUE_URL not set, skipping event emission');
    return;
  }

  try {
    const client = getSqsClient();

    await client.send(
      new SendMessageCommand({
        QueueUrl: QUEUE_URL,
        MessageBody: JSON.stringify(event),
        MessageAttributes: {
          eventType: {
            DataType: 'String',
            StringValue: event.type,
          },
          threadId: {
            DataType: 'String',
            StringValue: 'threadId' in event ? event.threadId : 'unknown',
          },
        },
      })
    );

    log.debug(`Emitted event: ${event.type} for thread ${'threadId' in event ? event.threadId : 'unknown'}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to emit event to SQS: ${errorMessage}`);
    // Don't throw - event emission failures shouldn't break execution
  }
}

/**
 * Emits an execution started event
 */
export async function emitExecutionStarted(params: {
  threadId: string;
  taskType: string;
  agentRole: string;
}): Promise<void> {
  await emitEvent({
    type: 'execution_started',
    ...params,
  });
}

/**
 * Emits a turn completed event
 */
export async function emitTurnCompleted(params: {
  threadId: string;
  turn: number;
  confidence: number;
  status: string;
}): Promise<void> {
  await emitEvent({
    type: 'turn_completed',
    ...params,
  });
}

/**
 * Emits a model escalated event
 */
export async function emitModelEscalated(params: {
  threadId: string;
  from: string;
  to: string;
  reason: string;
}): Promise<void> {
  await emitEvent({
    type: 'model_escalated',
    ...params,
  });
}

/**
 * Emits an execution completed event
 */
export async function emitExecutionCompleted(params: {
  threadId: string;
  totalTurns: number;
  finalStatus: string;
}): Promise<void> {
  await emitEvent({
    type: 'execution_completed',
    ...params,
  });
}

/**
 * Emits an execution aborted event
 */
export async function emitExecutionAborted(params: {
  threadId: string;
  reason: 'user_stop' | 'max_turns' | 'stuck';
}): Promise<void> {
  await emitEvent({
    type: 'execution_aborted',
    ...params,
  });
}

/**
 * Emits a commit created event
 */
export async function emitCommitCreated(params: {
  threadId: string;
  branch: string;
  commitHash: string;
}): Promise<void> {
  await emitEvent({
    type: 'commit_created',
    ...params,
  });
}

/**
 * Emits a branch merged event
 */
export async function emitBranchMerged(params: {
  threadId: string;
  branch: string;
}): Promise<void> {
  await emitEvent({
    type: 'branch_merged',
    ...params,
  });
}

/**
 * Emits a branch rejected event
 */
export async function emitBranchRejected(params: {
  threadId: string;
  branch: string;
}): Promise<void> {
  await emitEvent({
    type: 'branch_rejected',
    ...params,
  });
}
