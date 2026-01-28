import { createLogger } from '../../utils/logger';
import { executeTechnicalSimple } from '../execute';
import type { FlowContext, FlowResult } from './types';
import type { TaskType } from '../../modules/litellm/types';

const log = createLogger('FLOW:TECHNICAL_SIMPLE');

export async function executeTechnicalSimpleFlow(
  context: FlowContext,
  taskType: TaskType
): Promise<FlowResult> {
  log.info('Phase: TECHNICAL_SIMPLE_FLOW');

  const result = await executeTechnicalSimple({
    threadId: context.threadId,
    history: context.history,
    taskType,
  });

  return {
    response: result.response,
    model: result.model,
    responseChannelId: context.threadId,
  };
}
