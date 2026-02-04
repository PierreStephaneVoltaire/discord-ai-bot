import { createLogger } from '../../utils/logger';
import { chatCompletion } from '../../modules/litellm/index';
import { getModelFromTier } from '../../templates/registry';
import { loadPrompt } from '../../templates/loader';
import type { FlowContext, FlowResult } from './types';

const log = createLogger('FLOW:SOCIAL');

/**
 * Social Flow
 *
 * For social interactions, greetings, casual chat.
 * - Always uses Tier 1 models (cheapest, fastest)
 * - No tools, no planning
 * - Quick responses
 */
export async function executeSocialFlow(
  context: FlowContext
): Promise<FlowResult> {
  log.info('Phase: SOCIAL_FLOW');

  // Always use tier 1 model for social interactions
  const model = getModelFromTier('tier1', 0);
  log.info(`Using tier 1 model for social: ${model}`);

  // Load prompt from template file
  const systemPrompt = loadPrompt('social');

  const response = await chatCompletion({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: context.history.current_message },
    ],
  });

  const content = response.choices?.[0]?.message?.content || 'Hello!';

  return {
    response: content,
    model,
    responseChannelId: context.threadId,
  };
}
