/**
 * Stoat Adapter - wraps stoat.js to implement ChatClient interface
 */

type StoatClient = any;
import type {
  ChatClient,
  ChatMessage,
  ChatReaction,
  SendMessageOptions,
  ChatThread,
  ChatChannel,
} from '../types';
import { createLogger } from '../../../utils/logger';

const log = createLogger('CHAT:STOAT');

export interface StoatAdapterConfig {
  token: string;
  botId: string;
}

// Type definitions for Stoat.js (since we don't have exact types)
interface StoatMessage {
  id: string;
  channelId: string;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
  };
  attachments?: Array<{
    id: string;
    filename: string;
    url: string;
    contentType?: string;
    size: number;
  }>;
  mentions?: Array<{
    id: string;
    username: string;
  }>;
  timestamp: string;
  channel: {
    sendMessage: (content: string) => Promise<unknown>;
  };
  reply?: {
    channelId: string;
    messageId: string;
  };
}

interface StoatReaction {
  message: {
    id: string;
    channelId: string;
  };
  emoji: {
    name: string;
  };
  userId: string;
}

export class StoatAdapter implements ChatClient {
  public readonly platform = 'stoat' as const;
  public botUserId = '';
  public botUsername = '';
  public isReady = false;

  private client: StoatClient;
  private config: StoatAdapterConfig;
  private messageHandler?: (message: ChatMessage) => Promise<void>;
  private reactionHandler?: (reaction: ChatReaction) => Promise<void>;
  private readyHandler?: () => Promise<void>;
  private threadDeleteHandler?: (threadId: string) => Promise<void>;

  constructor(config: StoatAdapterConfig) {
    this.config = config;
    const StoatClientCtor = (require('stoat.js') as { Client: new () => StoatClient }).Client;
    this.client = new StoatClientCtor();
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('ready', async () => {
      // Stoat client has user property similar to Discord
      const user = (this.client as unknown as { user?: { id: string; username: string } }).user;
      log.info(`Stoat client ready as ${user?.username}`);
      this.botUserId = user?.id || '';
      this.botUsername = user?.username || '';
      this.isReady = true;

      if (this.readyHandler) {
        await this.readyHandler();
      }
    });

    this.client.on('messageCreate', async (message: StoatMessage) => {
      // Skip bot messages
      if (message.author.bot) return;

      if (this.messageHandler) {
        const chatMessage = this.convertMessage(message);
        await this.messageHandler(chatMessage);
      }
    });

    this.client.on('messageReactionAdd', async (reaction: StoatReaction, userId: string) => {
      if (this.reactionHandler) {
        const chatReaction: ChatReaction = {
          messageId: reaction.message.id,
          channelId: reaction.message.channelId,
          emoji: reaction.emoji.name,
          userId: userId,
        };
        await this.reactionHandler(chatReaction);
      }
    });

    // Stoat may have different event names for channel/thread deletion
    // This is a placeholder - adjust based on actual Stoat.js API
    this.client.on('channelDelete', async (channel: { id: string }) => {
      log.info(`Channel deleted: ${channel.id}`);
      if (this.threadDeleteHandler) {
        await this.threadDeleteHandler(channel.id);
      }
    });
  }

  private convertMessage(message: StoatMessage): ChatMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      guildId: null, // Stoat may have different server/guild concept
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        bot: message.author.bot,
        displayName: message.author.username,
      },
      attachments:
        message.attachments?.map((att) => ({
          id: att.id,
          filename: att.filename,
          url: att.url,
          contentType: att.contentType,
          size: att.size,
        })) || [],
      mentions:
        message.mentions?.map((m) => ({
          id: m.id,
          username: m.username,
        })) || [],
      timestamp: message.timestamp,
      replyTo: message.reply,
      // Stoat thread info may differ
      thread: undefined,
    };
  }

  async connect(): Promise<void> {
    log.info('Connecting to Stoat...');
    // Stoat uses loginBot method
    await (this.client as unknown as { loginBot: (token: string) => Promise<void> }).loginBot(
      this.config.token
    );
  }

  async disconnect(): Promise<void> {
    log.info('Disconnecting from Stoat...');
    this.isReady = false;
    // Stoat client may have different disconnect method
    // Adjust based on actual API
  }

  onMessage(handler: (message: ChatMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onReaction(handler: (reaction: ChatReaction) => Promise<void>): void {
    this.reactionHandler = handler;
  }

  onReady(handler: () => Promise<void>): void {
    this.readyHandler = handler;
  }

  onThreadDelete(handler: (threadId: string) => Promise<void>): void {
    this.threadDeleteHandler = handler;
  }

  async sendMessage(channelId: string, options: SendMessageOptions): Promise<void> {
    // Stoat API may differ - this is based on the example in their README
    // channel.sendMessage(content)

    // We need to get the channel first
    // Stoat client structure may differ from Discord.js
    const channel = await this.getChannel(channelId);
    if (!channel) {
      throw new Error(`Invalid channel: ${channelId}`);
    }

    log.info(`Sending message to Stoat channel ${channelId}: ${options.content.substring(0, 50)}...`);

    const clientAny = this.client as unknown as {
      channels?: {
        fetch?: (id: string) => Promise<{ sendMessage?: (content: string) => Promise<unknown>; send?: (content: string) => Promise<unknown> }>;
        get?: (id: string) => { sendMessage?: (content: string) => Promise<unknown>; send?: (content: string) => Promise<unknown> } | undefined;
      };
    };

    const channelApi = clientAny.channels?.fetch
      ? await clientAny.channels.fetch(channelId)
      : clientAny.channels?.get
        ? clientAny.channels.get(channelId)
        : null;

    if (channelApi?.sendMessage) {
      await channelApi.sendMessage(options.content);
      return;
    }

    if (channelApi?.send) {
      await channelApi.send(options.content);
      return;
    }

    throw new Error('Stoat channel send method not available');
  }

  async sendMessageChunks(channelId: string, content: string, maxLength = 1900): Promise<void> {
    const chunks = this.splitContent(content, maxLength);

    for (let i = 0; i < chunks.length; i++) {
      await this.sendMessage(channelId, { content: chunks[i] });

      if (i < chunks.length - 1) {
        await this.sleep(1500);
      }
    }
  }

  private splitContent(content: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = content;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.8) {
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength * 0.8) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trim();
    }

    return chunks;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async getHistory(channelId: string, limit = 50): Promise<ChatMessage[]> {
    // Stoat API for fetching history may differ
    log.debug(`Fetching history for Stoat channel ${channelId}, limit ${limit}`);

    const clientAny = this.client as unknown as {
      channels?: {
        fetch?: (id: string) => Promise<{ fetchMessages?: (options: { limit: number }) => Promise<StoatMessage[]>; messages?: { fetch?: (options: { limit: number }) => Promise<StoatMessage[]> } }>;
        get?: (id: string) => { fetchMessages?: (options: { limit: number }) => Promise<StoatMessage[]>; messages?: { fetch?: (options: { limit: number }) => Promise<StoatMessage[]> } } | undefined;
      };
    };

    const channelApi = clientAny.channels?.fetch
      ? await clientAny.channels.fetch(channelId)
      : clientAny.channels?.get
        ? clientAny.channels.get(channelId)
        : null;

    if (channelApi?.fetchMessages) {
      const messages = await channelApi.fetchMessages({ limit });
      return messages.map((msg) => this.convertMessage(msg));
    }

    if (channelApi?.messages?.fetch) {
      const messages = await channelApi.messages.fetch({ limit });
      return messages.map((msg) => this.convertMessage(msg));
    }

    return [];
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    // Stoat reaction API may differ
    log.debug(`Adding reaction ${emoji} to message ${messageId} in channel ${channelId}`);
  }

  async createThread(channelId: string, messageId: string, name: string): Promise<ChatThread> {
    // Stoat thread creation API may differ
    log.info(`Creating thread in Stoat channel ${channelId}: ${name}`);
    return {
      id: `${channelId}-thread-${Date.now()}`,
      name: name.substring(0, 100),
      channelId,
    };
  }

  async getChannel(channelId: string): Promise<ChatChannel | null> {
    try {
      // Stoat channel fetching API may differ
      const clientAny = this.client as unknown as {
        channels?: {
          fetch?: (id: string) => Promise<{ id: string; name?: string; type?: string | number; parentId?: string | null }>;
          get?: (id: string) => { id: string; name?: string; type?: string | number; parentId?: string | null } | undefined;
        };
      };

      const channel = clientAny.channels?.fetch
        ? await clientAny.channels.fetch(channelId)
        : clientAny.channels?.get
          ? clientAny.channels.get(channelId)
          : null;

      return {
        id: channel?.id || channelId,
        name: channel?.name || 'unknown',
        type: 'text',
        parentId: channel?.parentId || undefined,
      };
    } catch (error) {
      log.error(`Failed to fetch Stoat channel ${channelId}`, { error });
      return null;
    }
  }
}
