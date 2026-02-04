import { createLogger } from '../utils/logger';
import { generateExecutionId } from '../utils/id';
import {
  createExecution,
  markExecutionProcessing,
  markExecutionCompleted,
  markExecutionFailed,
  updateExecution,
} from '../modules/dynamodb/executions';
import { getSession } from '../modules/dynamodb/sessions';
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
  executeShellFlow,              // NEW: Shell command suggestions
  executeArchitectureFlow,       // NEW: Architecture/design flow
  executeSocialFlow,             // NEW: Social interactions (tier 1)
  executeProofreaderFlow,        // NEW: Grammar/spellcheck (tier 1)
  type FlowContext,
} from './flows';
import type { PipelineResult } from './types';
import { FlowType } from '../modules/litellm/types';
import { s3Sync } from '../modules/workspace/s3-sync';
import { discordFileSync, type SyncResult } from '../modules/workspace/file-sync';
import { getDiscordClient } from '../modules/discord/index';
import { getChatClient } from '../modules/chat';

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

  let threadId: string | undefined;

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

    threadId = thread.thread_id || thread.channel_id;
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
    // CRITICAL: Only sync workspace if we are in a thread
    // Social/proofreader flows don't need workspace, skip S3 sync for efficiency
    const isSocialOrProofreader = respondDecision.task_type === 'social' || respondDecision.task_type === 'proofreader';
    let syncResult: SyncResult = { synced: [], added: [], updated: [] };
    
    if (thread.is_thread && !isSocialOrProofreader) {
      log.info('Phase: WORKSPACE_SYNC');
      const chatClient = getChatClient();
      const client = getDiscordClient();

      // 1. Restore from S3 to workspace
      await s3Sync.syncFromS3(threadId);

      // 2. Sync latest attachments from Discord to workspace
      // CRITICAL: Only sync if we are in a thread. NOT the main channel.
      // Syncing main channel would download ALL history attachments.
      if (thread.thread_id) {
        if (chatClient && chatClient.platform !== 'discord') {
          log.info('Skipping discord file sync for non-Discord platform');
        } else {
          syncResult = await discordFileSync.syncToWorkspace(client, thread.thread_id);
        }
      } else {
        log.info('Skipping workspace file sync (not in a thread yet)');
      }
    } else {
      log.info(`Skipping WORKSPACE_SYNC (not in thread or simple flow: ${respondDecision.task_type})`);
    }
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
      // Get session for confidence score
      const session = await getSession(threadId);
      const confidenceScore = session?.confidence_score;

      log.info('Phase: CLASSIFY');
      const flowType = classifyFlow(
        respondDecision.is_technical,
        respondDecision.task_type,
        false,
        filterResult.context,
        message.content,
        confidenceScore
      );

      switch (flowType) {
        case FlowType.SEQUENTIAL_THINKING:
          flowResult = await executeSequentialThinkingFlow(flowContext, message);
          break;
        case FlowType.ARCHITECTURE:
          flowResult = await executeArchitectureFlow(flowContext, message);
          break;
        case FlowType.SOCIAL:
          flowResult = await executeSocialFlow(flowContext);
          break;
        case FlowType.PROOFREADER:
          flowResult = await executeProofreaderFlow(flowContext);
          break;
        case FlowType.BRANCH:
          flowResult = await executeBranchFlow(flowContext);
          break;
        case FlowType.SHELL:
          flowResult = await executeShellFlow(flowContext);
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
  } finally {
    // Phase: S3_SYNC (Outbound) - Always runs to preserve artifacts
    if (threadId) {
      log.info('Phase: S3_SYNC');
      try {
        await s3Sync.syncToS3(threadId);
      } catch (syncError) {
        log.error(`Failed to sync to S3 in finally block: ${syncError}`);
      }
    }
  }
}
