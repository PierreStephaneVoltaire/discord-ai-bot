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
import { setupSession, updateSessionAfterExecution } from './session';
import { processAttachments } from './attachments';
import { createPlan } from './planning';
import { executeTechnicalTask, executeSimple, executeTechnicalSimple, executeBreakglass } from './execute';
import { formatAndSendResponse } from './response';
import { executeAgenticLoop } from '../modules/agentic/loop';
import { getMaxTurns, getCheckpointInterval, getModelForAgent } from '../templates/registry';
import { generateThreadName } from '../modules/litellm/opus';
import { getDiscordClient, createThread } from '../modules/discord/index';
import { hasActiveLock } from '../modules/agentic/lock';
import { debounceMessage } from '../handlers/debounce';
import type { PipelineContext, PipelineResult } from './types';

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

    await markExecutionProcessing(executionId);

    // Check for breakglass flow
    if (filterResult.context.is_breakglass && filterResult.context.breakglass_model) {
      log.info('Phase: BREAKGLASS_FLOW');
      log.info(`Breakglass model: ${filterResult.context.breakglass_model}`);

      const result = await executeBreakglass({
        threadId,
        modelName: filterResult.context.breakglass_model,
        history,
      });

      await updateExecution(executionId, {
        gemini_response: { response_length: result.response.length },
      });

      log.info('Phase: SEND_RESPONSE');
      await formatAndSendResponse({
        response: result.response,
        channelId: thread.thread_id || thread.channel_id,
        branchName: undefined, // No branch for breakglass
      });

      await markExecutionCompleted(executionId, result.model);

      const elapsed = Date.now() - startTime;
      log.info('========== END PROCESSING (BREAKGLASS) ==========');
      log.info(`Total processing time: ${elapsed}ms`);

      return {
        success: true,
        execution_id: executionId,
        responded: true,
      };
    }

    log.info('Phase: CLASSIFY');
    const flowType = classifyFlow(
      respondDecision.is_technical,
      respondDecision.task_type,
      false // use_agentic_loop will be determined in planning phase
    );

    let response: string;
    let modelUsed: string;
    let branchName: string | undefined;
    let responseChannelId = thread.thread_id || thread.channel_id;

    if (flowType === 'agentic') {
      // AGENTIC FLOW - Multi-turn execution
      log.info('Phase: AGENTIC_FLOW');
      
      // Create thread if not already in one
      let finalThreadId = threadId;
      if (!thread.is_thread) {
        log.info('Creating thread for agentic execution');
        const threadName = await generateThreadName(history.current_message);
        const client = getDiscordClient();
        const newThread = await createThread(
          client,
          message.channel_id,
          message.id,
          threadName
        );
        finalThreadId = newThread.id;
        responseChannelId = newThread.id;
      }

      // Setup session
      const sessionResult = await setupSession(finalThreadId, thread.channel_id);
      branchName = sessionResult.branchName;

      // Process attachments
      const processedAttachments = await processAttachments(
        history.current_attachments,
        !filterResult.context.is_secondary_bot
      );

      // Generate plan
      const planning = await createPlan({
        threadId: finalThreadId,
        branchName: sessionResult.branchName,
        session: sessionResult.session,
        history,
        processedAttachments,
      });

      // Execute agentic loop
      const maxTurns = getMaxTurns(
        planning.complexity,
        planning.estimated_turns
      );

      const agenticResult = await executeAgenticLoop(
        {
          maxTurns,
          currentTurn: 0,
          model: getModelForAgent(planning.agent_role),
          agentRole: planning.agent_role,
          tools: [], // Tools loaded inside loop
          checkpointInterval: getCheckpointInterval(planning.complexity),
        },
        planning.reformulated_prompt,
        finalThreadId
      );

      response = agenticResult.finalResponse;
      modelUsed = 'agentic';

      // Update session
      await updateSessionAfterExecution(
        finalThreadId,
        planning,
        history.current_message,
        message.timestamp,
        sessionResult.session
      );
    } else if (flowType === 'technical-simple') {
      // TECHNICAL_SIMPLE FLOW - Single turn, no planning
      log.info('Phase: TECHNICAL_SIMPLE_FLOW');

      const result = await executeTechnicalSimple({
        threadId,
        history,
        taskType: respondDecision.task_type,
      });

      response = result.response;
      modelUsed = result.model;
    } else if (flowType === 'technical') {
      // TECHNICAL FLOW - Single turn with planning
      log.info('Phase: TECHNICAL_FLOW');
      // If technical but not in a thread, create one first
      let finalThreadId = threadId;
      if (!thread.is_thread) {
        log.info('Phase: CREATE_THREAD');
        log.info('Technical message not in thread, creating one');

        const threadName = await generateThreadName(history.current_message);
        log.info(`Generated thread name: ${threadName}`);

        const client = getDiscordClient();
        const newThread = await createThread(
          client,
          message.channel_id,
          message.id,
          threadName
        );

        finalThreadId = newThread.id;
        responseChannelId = newThread.id;
        log.info(`Created thread: ${finalThreadId}`);
      }

      log.info('Phase: SESSION_SETUP');
      const sessionResult = await setupSession(finalThreadId, thread.channel_id);
      branchName = sessionResult.branchName;

      log.info('Phase: ATTACHMENTS');
      const processedAttachments = await processAttachments(
        history.current_attachments,
      !filterResult.context.is_secondary_bot
      );

      await updateExecution(executionId, {
        input_context: {
          thread_id: finalThreadId,
          branch_name: branchName,
          message_content: history.current_message,
          attachment_count: processedAttachments.length,
        },
      });

      log.info('Phase: PLANNING');
      const planning = await createPlan({
        threadId: finalThreadId,
        branchName: sessionResult.branchName,
        session: sessionResult.session,
        history,
        processedAttachments,
      });

      await updateExecution(executionId, {
        opus_response: planning as unknown as Record<string, unknown>,
      });

      log.info('Phase: EXECUTE_TECHNICAL');
      const result = await executeTechnicalTask({
        threadId: finalThreadId,
        branchName: sessionResult.branchName,
        planning,
        history,
        processedAttachments,
      });

      response = result.response;
      modelUsed = result.model;

      log.info('Phase: UPDATE_SESSION');
      await updateSessionAfterExecution(
        finalThreadId,
        planning,
        history.current_message,
        message.timestamp,
        sessionResult.session
      );
    } else {
      // SIMPLE FLOW - Non-technical conversation
      log.info('Phase: SIMPLE_FLOW');
      const result = await executeSimple({
        threadId,
        history,
        isTechnical: false,
        taskType: respondDecision.task_type,
      });

      response = result.response;
      modelUsed = result.model;
    }

    await updateExecution(executionId, {
      gemini_response: { response_length: response.length },
    });

    log.info('Phase: SEND_RESPONSE');
    await formatAndSendResponse({
      response,
      channelId: responseChannelId,
      branchName,
    });

    await markExecutionCompleted(executionId, modelUsed);

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
