/**
 * Chat Platform Abstraction - Factory and exports
 */

import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import type { ChatClient, ChatClientConfig } from './types';
import { DiscordAdapter } from './adapters/discord';
import { StoatAdapter } from './adapters/stoat';

const log = createLogger('CHAT');

let cachedChatClient: ChatClient | null = null;

/**
 * Create a chat client based on configuration
 */
function createChatClient(): ChatClient {
  const config = getConfig();

  log.info(`Creating chat client for platform: ${config.CHAT_PLATFORM}`);

  switch (config.CHAT_PLATFORM) {
    case 'discord':
      if (!config.DISCORD_TOKEN) {
        throw new Error('DISCORD_TOKEN is required for Discord platform');
      }
      return new DiscordAdapter({
        token: config.DISCORD_TOKEN,
        botId: config.DISCORD_BOT_ID,
      });

    case 'stoat':
      if (!config.STOAT_TOKEN) {
        throw new Error('STOAT_TOKEN is required for Stoat platform');
      }
      return new StoatAdapter({
        token: config.STOAT_TOKEN,
        botId: config.STOAT_BOT_ID || '',
      });

    default:
      throw new Error(`Unknown chat platform: ${config.CHAT_PLATFORM}`);
  }
}

export function getChatClient(): ChatClient | null {
  const config = getConfig();
  if (config.CHAT_PLATFORM === 'discord') {
    return null;
  }

  if (!cachedChatClient) {
    cachedChatClient = createChatClient();
  }

  return cachedChatClient;
}

// Re-export types
export type {
  ChatClient,
  ChatMessage,
  ChatReaction,
  ChatAttachment,
  ChatMention,
  SendMessageOptions,
  ChatThread,
  ChatChannel,
  ChatClientConfig,
} from './types';

// Re-export adapters for direct use
export { DiscordAdapter } from './adapters/discord';
export { StoatAdapter } from './adapters/stoat';
