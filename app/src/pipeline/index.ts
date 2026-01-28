import { createLogger } from '../utils/logger';
import { generateExecutionId } from '../utils/id';
import {
  createExecution,
  markExecutionProcessing,
  markExecutionCompleted,
  markExecutionFailed,
  updateExecution,
} from '../modules/dynamodb/executions';
import type { DiscordMessagePayload } from '../modules/discord/types';
import { filterMessage } from './filter';
import { detectThread, shouldProcess } from './thread';
import { formatHistory } from './history';
import { checkShouldRespond } from './should-respond';
import { classifyFlow } from './classify';
import { formatAndSendResponse } from './response';
import {
  executeBreakglassFlow,
  executeSequentialThinkingFlow, // Renamed from agentic
  executeBranchFlow,             // NEW
  executeSimpleFlow,
  type FlowContext,
} from './flows';
import type { PipelineResult } from './types';
import { FlowType } from '../modules/litellm/types';
import { s3Sync } from '../modules/workspace/s3-sync';
import { discordFileSync } from '../modules/workspace/file-sync';
import { getDiscordClient } from '../modules/discord/index';

const log = createLogger('PIPELINE');

export async function processMessage(
  message: DiscordMessagePayload
): Promise<PipelineResult> {
  const startTime = Date.now();
  const executionId = generateExecutionId();

  log.info('========== START PROCESSING ==========');
  log.info(`Execution ID: ${executionId}`);
  log.info(`Message ID: ${message.id}`);
  log.info(`Author: ${message.author.username}`);
  log.info(`Channel: ${message.channel_id}`);

  try {
    // Phase 1: Pre-processing
    log.info('Phase: FILTER');
    const filterResult = filterMessage(message);

    if (!filterResult.passed) {
      log.info(`Message filtered out: ${filterResult.reason}`);
      return {
        success: true,
        execution_id: executionId,
        responded: false,
      };
    }

    log.info('Phase: THREAD_DETECTION');
    const thread = await detectThread(message);

    if (!shouldProcess(thread)) {
      log.info(`Message not in processable channel: ${thread.channel_name}`);
      return {
        success: true,
        execution_id: executionId,
        responded: false,
      };
    }

    const threadId = thread.thread_id || thread.channel_id;
    await createExecution(threadId, message.id);

    log.info('Phase: FORMAT_HISTORY');
    const history = await formatHistory(message, thread);

    log.info('Phase: SHOULD_RESPOND');
    const respondDecision = await checkShouldRespond({
      filter: filterResult.context,
      history,
      messageId: message.id,
    });

    if (!respondDecision.should_respond) {
      log.info(`Bot decided not to respond: ${respondDecision.reason}`);
      return {
        success: true,
        execution_id: executionId,
        responded: false,
      };
    }

    // Phase: WORKSPACE_SYNC (Inbound)
    log.info('Phase: WORKSPACE_SYNC');
    const client = getDiscordClient();

    // 1. Restore from S3 to workspace
    await s3Sync.syncFromS3(threadId);

    // 2. Sync latest attachments from Discord to workspace
    const syncResult = await discordFileSync.syncToWorkspace(client, threadId);
    const newFilesMessage = discordFileSync.getNewFilesMessage(syncResult);

    await markExecutionProcessing(executionId);

    // Build flow context
    const flowContext: FlowContext = {
      threadId,
      channelId: thread.channel_id,
      messageId: message.id,
      history,
      filterContext: filterResult.context,
      isThread: thread.is_thread,
      executionId,
      userAddedFilesMessage: newFilesMessage, // Pass to flows
    };

    // Phase 2: Route to appropriate flow
    let flowResult;

    if (filterResult.context.is_breakglass && filterResult.context.breakglass_model) {
      flowResult = await executeBreakglassFlow(
        flowContext,
        filterResult.context.breakglass_model
      );
    } else {
      log.info('Phase: CLASSIFY');
      const flowType = classifyFlow(
        respondDecision.is_technical,
        respondDecision.task_type,
        false,
        filterResult.context,
        message.content
      );

      switch (flowType) {
        case FlowType.SEQUENTIAL_THINKING:
          flowResult = await executeSequentialThinkingFlow(flowContext, message);
          break;
        case FlowType.BRANCH:
          flowResult = await executeBranchFlow(flowContext);
          break;
        case FlowType.SIMPLE:
        default:
          flowResult = await executeSimpleFlow(
            flowContext,
            respondDecision.task_type
          );
          break;
      }
    }

    // Phase 3: Post-processing
    await updateExecution(executionId, {
      gemini_response: { response_length: flowResult.response.length },
    });

    // Phase: S3_SYNC (Outbound)
    log.info('Phase: S3_SYNC');
    await s3Sync.syncToS3(threadId);

    log.info('Phase: SEND_RESPONSE');
    await formatAndSendResponse({
      response: flowResult.response,
      channelId: flowResult.responseChannelId,
      threadId: threadId,
    });

    await markExecutionCompleted(executionId, flowResult.model);

    const elapsed = Date.now() - startTime;
    log.info('========== END PROCESSING ==========');
    log.info(`Total processing time: ${elapsed}ms`);

    return {
      success: true,
      execution_id: executionId,
      responded: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Pipeline error: ${errorMessage}`);

    await markExecutionFailed(executionId, errorMessage);

    const elapsed = Date.now() - startTime;
    log.info('========== END PROCESSING (ERROR) ==========');
    log.info(`Total processing time: ${elapsed}ms`);

    return {
      success: false,
      execution_id: executionId,
      responded: false,
      error: errorMessage,
    };
  }
}
