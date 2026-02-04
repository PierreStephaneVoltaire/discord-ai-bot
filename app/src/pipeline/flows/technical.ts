import { createLogger } from '../../utils/logger';
import { setupSession, updateSessionAfterExecution } from '../session';
import { processAttachments } from '../attachments';
import { createPlan } from '../planning';
import { executeTechnicalTask } from '../execute';
import { generateThreadName } from '../../modules/litellm/opus';
import { getDiscordClient, createThread } from '../../modules/discord/index';
import { getChatClient } from '../../modules/chat';
import { updateExecution } from '../../modules/dynamodb/executions';
import type { FlowContext, FlowResult } from './types';
import type { DiscordMessagePayload } from '../../modules/discord/types';

const log = createLogger('FLOW:TECHNICAL');

export async function executeTechnicalFlow(
  context: FlowContext,
  message: DiscordMessagePayload
): Promise<FlowResult> {
  log.info('Phase: TECHNICAL_FLOW');
  
  // Create thread if not in one
  let finalThreadId = context.threadId;
  let responseChannelId = context.threadId;
  
  if (!context.isThread) {
    log.info('Phase: CREATE_THREAD');
    log.info('Technical message not in thread, creating one');

    const threadName = await generateThreadName(context.history.current_message);
    log.info(`Generated thread name: ${threadName}`);

  const chatClient = getChatClient();
    if (chatClient && chatClient.platform !== 'discord') {
      const newThread = await chatClient.createThread(
        message.channel_id,
        message.id,
        threadName
      );

      finalThreadId = newThread.id;
      responseChannelId = newThread.id;
      log.info(`Created thread (chat adapter): ${finalThreadId}`);
    } else {
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
  }

  log.info('Phase: SESSION_SETUP');
  const sessionResult = await setupSession(finalThreadId, context.channelId);
  const branchName = sessionResult.branchName;

  log.info('Phase: ATTACHMENTS');
  const processedAttachments = await processAttachments(
    context.history.current_attachments,
    !context.filterContext.is_secondary_bot
  );

  await updateExecution(context.executionId, {
    input_context: {
      thread_id: finalThreadId,
      branch_name: branchName,
      message_content: context.history.current_message,
      attachment_count: processedAttachments.length,
    },
  });

  log.info('Phase: PLANNING');
  const planning = await createPlan({
    threadId: finalThreadId,
    branchName: sessionResult.branchName,
    session: sessionResult.session,
    history: context.history,
    processedAttachments,
  });

  await updateExecution(context.executionId, {
    opus_response: planning as unknown as Record<string, unknown>,
  });

  log.info('Phase: EXECUTE_TECHNICAL');
  const result = await executeTechnicalTask({
    threadId: finalThreadId,
    branchName: sessionResult.branchName,
    planning,
    history: context.history,
    processedAttachments,
  });

  log.info('Phase: UPDATE_SESSION');
  await updateSessionAfterExecution(
    finalThreadId,
    planning,
    context.history.current_message,
    message.timestamp,
    sessionResult.session
  );

  return {
    response: result.response,
    model: result.model,
    branchName,
    responseChannelId,
  };
}
