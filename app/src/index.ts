import 'dotenv/config';
import Fastify from 'fastify';
import { loadConfig } from './config/index';
import { createLogger } from './utils/logger';
import { startDiscordBot, getDiscordClient } from './modules/discord/index';
import { processMessage } from './pipeline/index';
import { clearAllDebounceTimers } from './handlers/debounce';
import { setupReactionHandlers } from './handlers/reactions';
import { getTools } from './modules/litellm/index';

const log = createLogger('MAIN');

async function validateMcpTools(): Promise<void> {
  log.info('========================================');
  log.info('Validating MCP tools availability...');
  log.info('========================================');
  
  try {
    const tools = await getTools();
    
    if (tools.length === 0) {
      log.warn('⚠️  WARNING: No MCP tools available - bot will have limited functionality');
      log.warn('The bot can still respond to messages but cannot execute commands or modify files');
      log.warn('This may be expected if MCP server is not configured');
    } else {
      log.info(`✅ MCP tools validated successfully: ${tools.length} tools available`);
      log.info(`Available tools: ${tools.map(t => t.function.name).join(', ')}`);
      
      // Log the full tool schemas for debugging
      log.info('========================================');
      log.info('Tool schemas (OpenAI format):');
      log.info('========================================');
      tools.forEach(tool => {
        log.info(`Tool: ${tool.function.name}`);
        log.info(`  Description: ${tool.function.description}`);
        log.info(`  Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}`);
        log.info('----------------------------------------');
      });
    }
  } catch (error) {
    log.error('========================================');
    log.error('❌ FATAL: Failed to fetch or parse MCP tools from LiteLLM proxy');
    log.error('========================================');
    log.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    log.error('');
    log.error('This is a critical dependency failure. The bot cannot function without MCP tools.');
    log.error('');
    log.error('Please check:');
    log.error('  1. LiteLLM proxy is running at LITELLM_BASE_URL');
    log.error('  2. /mcp endpoint is accessible and returns valid JSON-RPC response');
    log.error('  3. MCP tools are properly configured in LiteLLM');
    log.error('  4. Network connectivity between bot and LiteLLM proxy');
    log.error('');
    log.error('Expected response format:');
    log.error('  { "result": { "tools": [ { "name": "...", "description": "...", "inputSchema": {...} } ] } }');
    log.error('========================================');
    
    throw new Error('MCP tools validation failed - cannot start bot');
  }
}

async function main() {
  log.info('Starting Discord Bot Application');

  try {
    const config = loadConfig();
    log.info('Configuration loaded');

    // Validate MCP tools before starting anything else
    // This ensures the critical dependency is available
    await validateMcpTools();

    const fastify = Fastify({ logger: false });

    fastify.get('/health', async () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    });

    fastify.get('/ready', async () => {
      return { status: 'ready', timestamp: new Date().toISOString() };
    });

    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    log.info(`Health server listening on port ${port}`);

    log.info('Starting Discord gateway connection');
    const client = await startDiscordBot(async (message) => {
      log.info(`Processing message ${message.id} from ${message.author.username}`);

      const result = await processMessage(message);

      if (result.error) {
        log.error(`Message processing failed: ${result.error}`);
      } else if (result.responded) {
        log.info(`Message processed successfully, responded: ${result.responded}`);
      } else {
        log.info(`Message processed, no response needed`);
      }
    });

    // Setup reaction handlers after bot is started
    setupReactionHandlers(client);

    log.info('Discord bot started successfully');

    process.on('SIGINT', async () => {
      log.info('Received SIGINT, shutting down');
      clearAllDebounceTimers();
      await fastify.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.info('Received SIGTERM, shutting down');
      clearAllDebounceTimers();
      await fastify.close();
      process.exit(0);
    });
  } catch (error) {
    log.error(`Failed to start application: ${error}`);
    process.exit(1);
  }
}

main();
