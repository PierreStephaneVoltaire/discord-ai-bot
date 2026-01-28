import {
  executeTask as geminiExecuteTask,
  executeSimpleTask,
} from '../modules/litellm/executor';
import { loadPrompt } from '../templates/loader';
import { getTemplateForAgent, getPromptForTaskType, getModelForTaskType, getModelForAgent } from '../templates/registry';
import { createLogger } from '../utils/logger';
import type { PlanningResult, TaskType } from '../modules/litellm/types';
import type { FormattedHistory, ProcessedAttachment } from './types';

const log = createLogger('EXECUTE');

export interface TechnicalExecuteInput {
  threadId: string;
  branchName: string;
  planning: PlanningResult;
  history: FormattedHistory;
  processedAttachments: ProcessedAttachment[];
}

export interface SimpleExecuteInput {
  threadId: string;
  history: FormattedHistory;
  isTechnical: boolean;
  taskType: TaskType;
}

export interface TechnicalSimpleExecuteInput {
  threadId: string;
  history: FormattedHistory;
  taskType: TaskType;
}

export async function executeTechnicalTask(
  input: TechnicalExecuteInput
): Promise<{ response: string; model: string }> {
  log.info(`Starting Gemini execution for thread ${input.threadId}`);
  log.info(`Branch: ${input.branchName}`);
  log.info(`Topic: ${input.planning.topic_slug}`);
  log.info(`Task type: ${input.planning.task_type}, Agent role: ${input.planning.agent_role}`);

  // Use template from agent role
  const templateName = getTemplateForAgent(input.planning.agent_role);
  let systemPrompt: string;
  try {
    systemPrompt = loadPrompt(templateName);
    log.info(`Using template: ${templateName}, length: ${systemPrompt.length}`);
  } catch (error) {
    log.warn(`Template ${templateName} not found, falling back to 'coding'`);
    systemPrompt = loadPrompt('coding');
  }

  // Get actual model name from agent role
  const modelName = getModelForAgent(input.planning.agent_role);
  log.info(`Using model: ${modelName} for agent role: ${input.planning.agent_role}`);

  const planContext = `
## Current Plan (plans/${input.planning.topic_slug}.md)
${input.planning.plan_content}

## Current Instructions (instructions/${input.planning.topic_slug}.md)
${input.planning.instruction_content}

## Branch: ${input.branchName}
`;

  let attachmentContext = '';
  if (input.processedAttachments.length > 0) {
    const names = input.processedAttachments.map((a) => a.filename).join(', ');
    attachmentContext = `\n\n## Uploaded Files (in /workspace/uploads/)\n${names}`;
  }

  const userPrompt = input.planning.reformulated_prompt + '\n\n' + planContext + attachmentContext;
  log.info(`User prompt length: ${userPrompt.length}`);
  log.info(`Tools will be loaded from MCP endpoint`);

  log.info('Calling Gemini');
  const response = await geminiExecuteTask(
    {
      systemPrompt,
      userPrompt,
      branchName: input.branchName,
      model: modelName,
    },
    input.threadId
  );

  log.info(`Gemini response length: ${response.length}`);
  log.info('Execution complete');

  return {
    response,
    model: modelName,
  };
}

export async function executeTechnicalSimple(
  input: TechnicalSimpleExecuteInput
): Promise<{ response: string; model: string }> {
  log.info(`Starting technical-simple execution for thread ${input.threadId}`);
  log.info(`Task type: ${input.taskType}`);

  // Get template and model from registry
  const promptCategory = getPromptForTaskType(input.taskType);
  const model = getModelForTaskType(input.taskType);

  log.info(`Using prompt category: ${promptCategory}, model: ${model}`);

  const fullHistory = input.history.formatted_history
    ? `${input.history.formatted_history}\n\n${input.history.current_author}: ${input.history.current_message}`
    : `${input.history.current_author}: ${input.history.current_message}`;

  // Technical-simple tasks don't need tools (they're Q&A, explanations, etc.)
  const response = await executeSimpleTask(
    promptCategory,
    fullHistory,
    input.threadId,
    model,
    false // No tools for technical-simple
  );

  log.info(`Technical-simple execution complete, response length: ${response.length}`);

  return {
    response,
    model,
  };
}

export async function executeSimple(
  input: SimpleExecuteInput
): Promise<{ response: string; model: string }> {
  log.info(`Starting simple execution for thread ${input.threadId}`);
  log.info(`Task type: ${input.taskType}`);

  // Get template and model from registry based on task type
  const promptCategory = getPromptForTaskType(input.taskType);
  const model = getModelForTaskType(input.taskType);
  
  log.info(`Using prompt category: ${promptCategory}, model: ${model}`);

  const fullHistory = input.history.formatted_history
    ? `${input.history.formatted_history}\n\n${input.history.current_author}: ${input.history.current_message}`
    : `${input.history.current_author}: ${input.history.current_message}`;

  const response = await executeSimpleTask(
    promptCategory,
    fullHistory,
    input.threadId,
    model,
    false // Simple flow never needs tools
  );

  log.info(`Simple execution complete, response length: ${response.length}`);

  return {
    response,
    model,
  };
}

const BREAKGLASS_MODEL_MAP: Record<string, string> = {
  'opus': 'claude-opus-4.5',
  'sonnet': 'claude-sonnet-4.5',
  'gemini': 'gemini-3-pro',
  'qwen': 'qwen3-max',
  'gpt': 'gpt-5.2-codex',
  'default': 'gemini-2.5-flash-lite',
  'glm': 'glm-4.7',
};

export interface BreakglassExecuteInput {
  threadId: string;
  modelName: string;
  history: FormattedHistory;
}

export async function executeBreakglass(
  input: BreakglassExecuteInput
): Promise<{ response: string; model: string }> {
  log.info(`Starting breakglass execution for thread ${input.threadId}`);
  log.info(`Requested model: ${input.modelName}`);

  // Map the model name to actual LiteLLM model string
  const actualModel = BREAKGLASS_MODEL_MAP[input.modelName.toLowerCase()];
  if (!actualModel) {
    throw new Error(`Invalid breakglass model: ${input.modelName}`);
  }

  log.info(`Using model: ${actualModel}`);

  // Load the breakglass template
  const systemPrompt = loadPrompt('breakglass');
  log.info(`Breakglass template loaded, length: ${systemPrompt.length}`);

  // Strip the @{modelname} prefix from the message
  const strippedMessage = input.history.current_message.replace(/^@\w+\s*/, '');
  log.info(`Stripped message: ${strippedMessage}`);

  // Format the user prompt with history and current message
  const historyText = input.history.formatted_history || 'No previous messages.';
  const userPrompt = systemPrompt
    .replace('{{history}}', historyText)
    .replace('{{message}}', strippedMessage);

  log.info(`User prompt length: ${userPrompt.length}`);

  // Call the model directly without tools
  const response = await executeSimpleTask(
    'breakglass',
    userPrompt,
    input.threadId,
    actualModel,
    false // No tools for breakglass
  );

  log.info(`Breakglass execution complete, response length: ${response.length}`);

  return {
    response,
    model: actualModel,
  };
}
