import { createLogger } from '../../utils/logger';
import { setupSession, updateSessionAfterExecution } from '../session';
import { processAttachments } from '../attachments';
import { createPlan } from '../planning';
import { executeAgenticLoop } from '../../modules/agentic/loop';
import { getMaxTurns, getCheckpointInterval, getModelForAgent } from '../../templates/registry';
import { generateThreadName } from '../../modules/litellm/opus';
import { getDiscordClient, createThread } from '../../modules/discord/index';
import type { FlowContext, FlowResult } from './types';
import type { DiscordMessagePayload } from '../../modules/discord/types';

const log = createLogger('FLOW:AGENTIC');

export async function executeAgenticFlow(
  context: FlowContext,
  message: DiscordMessagePayload
): Promise<FlowResult> {
  log.info('Phase: AGENTIC_FLOW');
  
  // Create thread if not already in one
  let finalThreadId = context.threadId;
  let responseChannelId = context.threadId;
  
  if (!context.isThread) {
    log.info('Creating thread for agentic execution');
    const threadName = await generateThreadName(context.history.current_message);
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
  const sessionResult = await setupSession(finalThreadId, context.channelId);
  const branchName = sessionResult.branchName;

  // Process attachments
  const processedAttachments = await processAttachments(
    context.history.current_attachments,
    !context.filterContext.is_secondary_bot
  );

  // Generate plan
  const planning = await createPlan({
    threadId: finalThreadId,
    branchName: sessionResult.branchName,
    session: sessionResult.session,
    history: context.history,
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

  // Update session
  await updateSessionAfterExecution(
    finalThreadId,
    planning,
    context.history.current_message,
    message.timestamp,
    sessionResult.session
  );

  return {
    response: agenticResult.finalResponse,
    model: 'agentic',
    branchName,
    responseChannelId,
  };
}
