import { request } from 'undici';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import { getLiteLLMAgent } from './agent';
import type { ChatCompletionRequest, ChatCompletionResponse, Tool, McpTool, ToolCall } from './types';

const log = createLogger('LITELLM');

export async function getTools(): Promise<Tool[]> {
  const config = getConfig();
  const url = `${config.LITELLM_BASE_URL}/v1/mcp/tools`;

  log.info(`Fetching tools from: ${url}`);
  log.info('Request details:', {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'x-litellm-api-key': config.LITELLM_API_KEY ? '***' : 'MISSING',
    }
  });

  try {
    const startTime = Date.now();
    const response = await request(url, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'x-litellm-api-key': config.LITELLM_API_KEY,
      },
      dispatcher: getLiteLLMAgent(), // Use shared agent with connection pooling
    });
    const elapsedMs = Date.now() - startTime;
    log.info(`⏱️ LiteLLM getTools HTTP call completed in ${elapsedMs}ms`);

    log.info(`Response status: ${response.statusCode}`);
    log.info(`Response headers:`, response.headers);

    if (response.statusCode !== 200) {
      const errorText = await response.body.text();
      log.error(`Failed to fetch tools: ${response.statusCode}`, { error: errorText });
      throw new Error(`MCP tools endpoint returned ${response.statusCode}: ${errorText}`);
    }

    const rawBody = await response.body.text();
    // log.info('Raw response body:', { rawBody });

    let data;
    try {
      data = JSON.parse(rawBody) as { tools: McpTool[] };
    } catch (parseError) {
      log.error('Failed to parse response as JSON', { parseError, rawBody });
      throw new Error(`Invalid JSON response from MCP endpoint: ${parseError}`);
    }

    // Log the full response object for debugging
    /*
    log.info('MCP Response Object:', {
      fullResponse: JSON.stringify(data, null, 2),
      hasTools: !!data.tools,
      toolsCount: data.tools?.length || 0
    });
    */

    if (!data.tools || !Array.isArray(data.tools)) {
      log.error('Invalid MCP response format', { data });
      throw new Error('MCP endpoint returned invalid format - missing tools array');
    }

    const mcpTools = data.tools;
    log.info(`Fetched ${mcpTools.length} MCP tools from endpoint`);

    // Log each tool's structure
    /*
    mcpTools.forEach((tool, index) => {
      log.info(`Tool ${index + 1}/${mcpTools.length}:`, {
        name: tool.name,
        description: tool.description,
        hasInputSchema: !!tool.inputSchema,
        inputSchemaKeys: tool.inputSchema ? Object.keys(tool.inputSchema) : []
      });
    });
    */

    // Convert MCP tools to OpenAI format
    const openAiTools = mcpTools.map((tool) => {
      const converted: Tool = {
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: (tool.inputSchema as any) || {},
        },
      };

      return converted;
    });

    log.info(`Converted ${openAiTools.length} tools to OpenAI format`);

    // Log converted tool structure for verification
    /*
    log.info('Converted Tools Sample:', {
      firstTool: openAiTools[0] ? {
        type: openAiTools[0].type,
        functionName: openAiTools[0].function.name,
        hasDescription: !!openAiTools[0].function.description,
        hasParameters: !!openAiTools[0].function.parameters
      } : null
    });
    */

    return openAiTools;
  } catch (error) {
    log.error('Error fetching or converting MCP tools', { error });
    throw error; // Re-throw to let caller handle
  }
}

export async function chatCompletion(
  requestBody: ChatCompletionRequest
): Promise<ChatCompletionResponse> {
  log.info(`chatCompletion request, model: ${requestBody.model}`);

  const config = getConfig();
  const url = `${config.LITELLM_BASE_URL}/v1/chat/completions`;

  const body = JSON.stringify(requestBody);
  log.info(`Request payload: ${body}`);

  const startTime = Date.now();

  const response = await request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.LITELLM_API_KEY}`,
    },
    body,
    dispatcher: getLiteLLMAgent(), // Use shared agent with connection pooling
  });

  const elapsedMs = Date.now() - startTime;
  log.info(`⏱️ LiteLLM HTTP call completed in ${elapsedMs}ms, status: ${response.statusCode}`);

  if (response.statusCode !== 200) {
    const errorText = await response.body.text();
    log.error(`LiteLLM error: ${response.statusCode}`, { error: errorText });
    throw new Error(`LiteLLM request failed: ${response.statusCode} - ${errorText}`);
  }

  const data = (await response.body.json()) as ChatCompletionResponse;

  log.info(`Response data: ${JSON.stringify(data)}`);

  return data;
}

export function extractContent(response: ChatCompletionResponse): string {
  return response.choices?.[0]?.message?.content || '';
}

export function extractJsonFromContent<T>(content: string): T | null {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    return JSON.parse(jsonMatch[0]) as T;
  } catch {
    return null;
  }
}

export * from './opus';
export * from './executor';
export * from './types';
export * from './agent'; // Export agent for connection management
