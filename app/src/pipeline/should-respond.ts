import { shouldRespond as opusShouldRespond } from '../modules/litellm/opus';
import { getConfig } from '../config/index';
import { createLogger } from '../utils/logger';
import { TaskType, AgentRole, TaskComplexity } from '../modules/litellm/types';
import type { FilterContext, FormattedHistory } from './types';

const log = createLogger('SHOULD_RESPOND');

export interface ShouldRespondInput {
  filter: FilterContext;
  history: FormattedHistory;
  messageId: string;
}

export interface ShouldRespondOutput {
  should_respond: boolean;
  reason: string;
  is_technical: boolean;
  task_type: TaskType;
  agent_role?: AgentRole;
  complexity?: TaskComplexity;
}

export async function checkShouldRespond(
  input: ShouldRespondInput
): Promise<ShouldRespondOutput> {
  const config = getConfig();
  log.info(`Checking if bot should respond`);
  log.info(`Force respond: ${input.filter.force_respond}`);
  log.info(`Is secondary bot (${config.OTHER_BOT_USERNAME}): ${input.filter.is_secondary_bot}`);

  // Bypass for breakglass flow
  if (input.filter.is_breakglass) {
    log.info(`Breakglass flow detected: model=${input.filter.breakglass_model}`);
    return {
      should_respond: true,
      reason: `Breakglass invocation with @${input.filter.breakglass_model}`,
      is_technical: false,
      task_type: TaskType.GENERAL_CONVO,
    };
  }

  if (input.filter.force_respond) {
    const reason = input.filter.is_mentioned
      ? 'User @mentioned the bot'
      : `Message from ${config.OTHER_BOT_USERNAME}`;
    log.info(`Force respond triggered: ${reason}`);

    return {
      should_respond: true,
      reason,
      is_technical: true,
      task_type: TaskType.CODING_IMPLEMENTATION,
    };
  }

  log.info('Calling Opus for decision');

  const opusResult = await opusShouldRespond(
    {
      author: input.history.current_author,
      force_respond: input.filter.force_respond,
      is_secondary_bot: input.filter.is_secondary_bot,
      history: input.history.formatted_history,
      message: input.history.current_message,
    },
    input.messageId
  );

  log.info(`Opus raw result: should_respond=${opusResult.should_respond}, is_technical=${opusResult.is_technical}`);
  log.info(`Opus reason: ${opusResult.reason}`);

  let finalShouldRespond = opusResult.should_respond;
  let finalReason = opusResult.reason;

  if (input.filter.is_secondary_bot && !finalShouldRespond) {
    const config = getConfig();
    log.info(`Overriding: ${config.OTHER_BOT_USERNAME} messages always get a response`);
    finalShouldRespond = true;
    finalReason = `Message from ${config.OTHER_BOT_USERNAME} (override)`;
  }

  log.info(`Final decision: should_respond=${finalShouldRespond}, reason=${finalReason}`);

  return {
    should_respond: finalShouldRespond,
    reason: finalReason,
    is_technical: opusResult.is_technical,
    task_type: opusResult.task_type,
    agent_role: opusResult.agent_role,
    complexity: opusResult.complexity,
  };
}
