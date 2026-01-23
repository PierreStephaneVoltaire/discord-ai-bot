import type { Client, Message } from 'discord.js';
import { createLogger } from '../../utils/logger';
import type { DiscordMessagePayload } from './types';

const log = createLogger('DISCORD:EVENT');

export type MessageHandler = (payload: DiscordMessagePayload) => Promise<void>;

export function setupEventHandlers(client: Client, onMessage: MessageHandler): void {
  log.info('Setting up event handlers');

  client.on('ready', () => {
    log.info(`on_ready triggered`);
    log.info(`Gateway connected as ${client.user?.username} (ID: ${client.user?.id})`);
  });

  client.on('messageCreate', async (message: Message) => {
    log.info(`on_message: ${message.id} in channel ${message.channel.id}`);
    log.info(`Message content length: ${message.content.length}`);
    log.info(`Attachments count: ${message.attachments.size}`);

    const payload = messageToPayload(message);

    try {
      await onMessage(payload);
    } catch (error) {
      log.error(`Error processing message ${message.id}`, { error: String(error) });
    }
  });

  log.info('Event handlers configured');
}

function messageToPayload(message: Message): DiscordMessagePayload {
  return {
    id: message.id,
    channel_id: message.channel.id,
    guild_id: message.guild?.id || null,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot,
      global_name: message.author.globalName || undefined,
    },
    attachments: Array.from(message.attachments.values()).map((att) => ({
      id: att.id,
      filename: att.name,
      url: att.url,
      proxy_url: att.proxyURL,
      content_type: att.contentType || undefined,
      size: att.size,
    })),
    mentions: Array.from(message.mentions.users.values()).map((u) => ({
      id: u.id,
      username: u.username,
      global_name: u.globalName || undefined,
    })),
    timestamp: message.createdAt.toISOString(),
    message_reference: message.reference
      ? {
          channel_id: message.reference.channelId,
          message_id: message.reference.messageId || '',
        }
      : undefined,
    thread: message.thread
      ? {
          id: message.thread.id,
          name: message.thread.name,
        }
      : undefined,
  };
}
