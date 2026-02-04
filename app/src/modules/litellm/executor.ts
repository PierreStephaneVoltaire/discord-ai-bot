import { chatCompletion, extractContent, getTools } from './index';
import { loadPrompt } from '../../templates/loader';
import { createLogger } from '../../utils/logger';
import type { Tool, ExecuteContext } from './types';

const log = createLogger('LITELLM:EXECUTOR');

export async function executeTask(
  context: ExecuteContext,
  threadId: string
): Promise<string> {
  log.info(`executeTask for thread ${threadId}`);
  log.info(`Branch: ${context.branchName}`);

  const tools = await getTools();

  const sandboxContext = `
## Sandbox Access
You can execute commands in the sandbox pod using the available tools.
Pod: sandbox | Namespace: discord-bot | Working directory: /workspace
Branch: ${context.branchName}

Use the provided tools to:
- Read/Write files
- List directories
- Execute git operations
`;

  const fullSystemPrompt = context.systemPrompt + '\n\n' + sandboxContext;

  log.info(`System prompt length: ${fullSystemPrompt.length}`);
  log.info(`User prompt length: ${context.userPrompt.length}`);
  log.info(`Tools provided: ${tools.map(t => t.function.name).join(', ')}`);

  const startTime = Date.now();
  const response = await chatCompletion({
    model: context.model || 'gemini-3-pro',
    messages: [
      { role: 'system', content: fullSystemPrompt },
      { role: 'user', content: context.userPrompt },
    ],
    tools: tools,
    tool_choice: 'auto',
  });
  const elapsedMs = Date.now() - startTime;
  log.info(`⏱️ executeTask completed in ${elapsedMs}ms`);

  const content = extractContent(response);
  const toolCallCount = response.choices?.[0]?.message?.tool_calls?.length || 0;

  log.info(`Execution complete, response length: ${content.length}`);
  log.info(`Tool calls made: ${toolCallCount}`);

  return content || 'Task completed using tools.';
}

export async function executeSimpleTask(
  promptCategory: string,
  history: string,
  threadId: string,
  model?: string,
  enableTools: boolean = false
): Promise<string> {
  log.info(`executeSimpleTask for thread ${threadId}, prompt: ${promptCategory}, model: ${model || 'general'}, tools: ${enableTools}`);

  const systemPrompt = loadPrompt(promptCategory);
  log.info(`System prompt loaded: ${promptCategory}, length: ${systemPrompt.length}`);

  // Get tools if enabled
  let tools: Tool[] = [];
  if (enableTools) {
    tools = await getTools();
    log.info(`Tools loaded: ${tools.map(t => t.function.name).join(', ')}`);
    
    if (tools.length === 0) {
      log.warn('No MCP tools available - model will not be able to execute commands');
    }
  }

  const startTime = Date.now();
  const response = await chatCompletion({
    model: model || 'gemini-3-pro',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: history },
    ],
    tools: enableTools && tools.length > 0 ? tools : undefined,
    tool_choice: enableTools && tools.length > 0 ? 'auto' : undefined,
  });
  const elapsedMs = Date.now() - startTime;
  log.info(`⏱️ executeSimpleTask completed in ${elapsedMs}ms`);

  const content = extractContent(response);
  const toolCallCount = response.choices?.[0]?.message?.tool_calls?.length || 0;
  
  log.info(`Simple task complete, response length: ${content.length}`);
  if (enableTools) {
    log.info(`Tool calls made: ${toolCallCount}`);
  }

  return content || 'No response generated.';
}
