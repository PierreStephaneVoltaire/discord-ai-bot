import { createLogger } from '../../utils/logger';
import { executeBreakglass } from '../execute';
import type { FlowContext, FlowResult } from './types';

const log = createLogger('FLOW:BREAKGLASS');

export async function executeBreakglassFlow(
  context: FlowContext,
  modelName: string
): Promise<FlowResult> {
  log.info('Phase: BREAKGLASS_FLOW');
  log.info(`Breakglass model: ${modelName}`);

  const result = await executeBreakglass({
    threadId: context.threadId,
    modelName,
    history: context.history,
  });

  return {
    response: result.response,
    model: result.model,
    responseChannelId: context.threadId,
  };
}
