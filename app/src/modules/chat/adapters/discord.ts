/**
 * Discord Adapter - wraps discord.js to implement ChatClient interface
 */

import { Client, GatewayIntentBits, Partials, TextChannel, ThreadChannel, Message, AttachmentBuilder } from 'discord.js';
import type {
  ChatClient,
  ChatMessage,
  ChatReaction,
  SendMessageOptions,
  ChatThread,
  ChatChannel,
} from '../types';
import { createLogger } from '../../../utils/logger';

const log = createLogger('CHAT:DISCORD');

export interface DiscordAdapterConfig {
  token: string;
  botId: string;
}

export class DiscordAdapter implements ChatClient {
  public readonly platform = 'discord' as const;
  public botUserId = '';
  public botUsername = '';
  public isReady = false;

  private client: Client;
  private config: DiscordAdapterConfig;
  private messageHandler?: (message: ChatMessage) => Promise<void>;
  private reactionHandler?: (reaction: ChatReaction) => Promise<void>;
  private readyHandler?: () => Promise<void>;
  private threadDeleteHandler?: (threadId: string) => Promise<void>;

  constructor(config: DiscordAdapterConfig) {
    this.config = config;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
      partials: [Partials.Message, Partials.Channel, Partials.Reaction],
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('ready', async () => {
      log.info(`Discord client ready as ${this.client.user?.username}`);
      this.botUserId = this.client.user?.id || '';
      this.botUsername = this.client.user?.username || '';
      this.isReady = true;

      if (this.readyHandler) {
        await this.readyHandler();
      }
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;

      if (this.messageHandler) {
        const chatMessage = this.convertMessage(message);
        await this.messageHandler(chatMessage);
      }
    });

    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.bot) return;

      // Handle partials
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          log.error('Failed to fetch partial reaction', { error });
          return;
        }
      }

      if (this.reactionHandler) {
        const chatReaction: ChatReaction = {
          messageId: reaction.message.id,
          channelId: reaction.message.channelId,
          emoji: reaction.emoji.name || '',
          userId: user.id,
        };
        await this.reactionHandler(chatReaction);
      }
    });

    this.client.on('threadDelete', async (thread) => {
      log.info(`Thread deleted: ${thread.id}`);
      if (this.threadDeleteHandler) {
        await this.threadDeleteHandler(thread.id);
      }
    });
  }

  private convertMessage(message: Message): ChatMessage {
    return {
      id: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      content: message.content,
      author: {
        id: message.author.id,
        username: message.author.username,
        bot: message.author.bot,
        displayName: message.author.globalName || message.author.username,
      },
      attachments: Array.from(message.attachments.values()).map((att) => ({
        id: att.id,
        filename: att.name,
        url: att.url,
        contentType: att.contentType || undefined,
        size: att.size,
      })),
      mentions: Array.from(message.mentions.users.values()).map((u) => ({
        id: u.id,
        username: u.username,
      })),
      timestamp: message.createdAt.toISOString(),
      replyTo: message.reference
        ? {
            channelId: message.reference.channelId || message.channelId,
            messageId: message.reference.messageId || '',
          }
        : undefined,
      thread:
        message.channel.type === 11 || message.channel.type === 12
          ? {
              id: message.channel.id,
              name: (message.channel as ThreadChannel).name,
            }
          : undefined,
    };
  }

  async connect(): Promise<void> {
    log.info('Connecting to Discord...');
    await this.client.login(this.config.token);
  }

  async disconnect(): Promise<void> {
    log.info('Disconnecting from Discord...');
    this.isReady = false;
    await this.client.destroy();
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
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Invalid channel: ${channelId}`);
    }

    const messageOptions: { content: string; files?: AttachmentBuilder[] } = {
      content: options.content,
    };

    if (options.files && options.files.length > 0) {
      messageOptions.files = options.files.map(
        (f) => new AttachmentBuilder(f.data, { name: f.name })
      );
    }

    await (channel as TextChannel | ThreadChannel).send(messageOptions);
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

      // Try to split at a newline
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.8) {
        // Split at space if no good newline
        splitIndex = remaining.lastIndexOf(' ', maxLength);
      }
      if (splitIndex === -1 || splitIndex < maxLength * 0.8) {
        // Force split at maxLength
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
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Invalid channel: ${channelId}`);
    }

    const messages = await (channel as TextChannel | ThreadChannel).messages.fetch({ limit });

    return Array.from(messages.values())
      .reverse()
      .map((msg) => this.convertMessage(msg));
  }

  async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Invalid channel: ${channelId}`);
    }

    const message = await (channel as TextChannel | ThreadChannel).messages.fetch(messageId);
    await message.react(emoji);
  }

  async createThread(channelId: string, messageId: string, name: string): Promise<ChatThread> {
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || channel.type !== 0) {
      // 0 = GuildText
      throw new Error(`Invalid channel for thread creation: ${channelId}`);
    }

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(messageId);

    const thread = await message.startThread({
      name: name.substring(0, 100),
      autoArchiveDuration: 1440,
    });

    return {
      id: thread.id,
      name: thread.name,
      channelId: thread.parentId || channelId,
    };
  }

  async getChannel(channelId: string): Promise<ChatChannel | null> {
    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel) return null;

      let type: ChatChannel['type'] = 'text';
      if (channel.type === 11 || channel.type === 12) {
        type = 'thread';
      } else if (channel.type === 1) {
        type = 'dm';
      }

      return {
        id: channel.id,
        name: 'name' in channel ? (channel.name as string) : 'unknown',
        type,
        parentId: 'parentId' in channel ? (channel.parentId as string) : undefined,
      };
    } catch (error) {
      log.error(`Failed to fetch channel ${channelId}`, { error });
      return null;
    }
  }
}
