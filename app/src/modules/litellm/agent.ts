import { Agent } from 'undici';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';

const log = createLogger('LITELLM:AGENT');

let sharedAgent: Agent | null = null;

/**
 * Get or create the shared HTTP agent for LiteLLM connections
 * This enables connection pooling and keep-alive for better performance
 */
export function getLiteLLMAgent(): Agent {
  if (!sharedAgent) {
    const config = getConfig();

    sharedAgent = new Agent({
      keepAliveTimeout: 30000,      // 30 seconds
      keepAliveMaxTimeout: 60000,   // 60 seconds max
      connections: config.LITELLM_MAX_CONNECTIONS || 50,
      pipelining: 1,                // HTTP/1.1 pipelining
    });

    log.info('LiteLLM HTTP agent initialized', {
      maxConnections: config.LITELLM_MAX_CONNECTIONS || 50,
      keepAliveTimeout: 30000,
    });
  }

  return sharedAgent;
}

/**
 * Close the shared HTTP agent
 * Call this during graceful shutdown
 */
export async function closeLiteLLMAgent(): Promise<void> {
  if (sharedAgent) {
    log.info('Closing LiteLLM HTTP agent');
    await sharedAgent.close();
    sharedAgent = null;
  }
}

/**
 * Get agent stats for monitoring
 */
export function getLiteLLMAgentStats(): {
  connected: boolean;
  connections: number;
} {
  if (!sharedAgent) {
    return { connected: false, connections: 0 };
  }

  // undici doesn't expose connection count directly
  // but we can track usage through logs
  return { connected: true, connections: -1 };
}
