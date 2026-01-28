import { createLogger } from '../../utils/logger';
import { executeSimple } from '../execute';
import type { FlowContext, FlowResult } from './types';
import type { TaskType } from '../../modules/litellm/types';

const log = createLogger('FLOW:SIMPLE');

export async function executeSimpleFlow(
  context: FlowContext,
  taskType: TaskType
): Promise<FlowResult> {
  log.info('Phase: SIMPLE_FLOW');
  
  const result = await executeSimple({
    threadId: context.threadId,
    history: context.history,
    isTechnical: false,
    taskType,
  });

  return {
    response: result.response,
    model: result.model,
    responseChannelId: context.threadId,
  };
}
