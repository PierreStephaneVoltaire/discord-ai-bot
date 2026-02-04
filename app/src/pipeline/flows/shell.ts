import { createLogger } from '../../utils/logger';
import { executeSimpleTask } from '../../modules/litellm/executor';
import { getPromptForTaskType, getModelForTaskType } from '../../templates/registry';
import type { FlowContext, FlowResult } from './types';
import { TaskType } from '../../modules/litellm/types';

const log = createLogger('FLOW:SHELL');

/**
 * Execute shell command flow
 * 
 * This flow is triggered when the user asks for shell command suggestions.
 * It uses a simple execution without MCP tools - just suggesting commands.
 * 
 * Key characteristics:
 * - Suggests 1-3 ready-to-execute one-liner commands
 * - No multi-line scripts (if user wants scripts, they should use coding flow)
 * - If OS not specified, provides both Linux and Windows versions
 * - Commands are complete with no placeholders
 * - Uses a random tier 2 model (no tools needed)
 */
export async function executeShellFlow(
  context: FlowContext
): Promise<FlowResult> {
  log.info('Phase: SHELL_FLOW');
  log.info(`Thread: ${context.threadId}`);

  // Get the prompt category and model for shell commands
  const promptCategory = getPromptForTaskType(TaskType.SHELL_COMMAND);
  const model = getModelForTaskType(TaskType.SHELL_COMMAND);

  log.info(`Using prompt category: ${promptCategory}, model: ${model}`);

  // Format the full history with current message
  const fullHistory = context.history.formatted_history
    ? `${context.history.formatted_history}\n\n${context.history.current_author}: ${context.history.current_message}`
    : `${context.history.current_author}: ${context.history.current_message}`;

  // Execute the task without tools (shell flow is suggestion-only)
  const response = await executeSimpleTask(
    promptCategory,
    fullHistory,
    context.threadId,
    model,
    false // No tools for shell flow - just suggestions
  );

  log.info(`Shell flow complete, response length: ${response.length}`);

  return {
    response,
    model,
    responseChannelId: context.threadId,
  };
}
