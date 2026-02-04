import {
  Client,
  TextChannel,
  ThreadChannel,
  ChannelType,
  AttachmentBuilder,
} from 'discord.js';
import { createLogger } from '../../utils/logger';
import type { ChannelInfo, SendMessageOptions } from './types';

export interface PollOption {
  id: string;
  label: string;
  description: string;
}

export interface CreatePollOptions {
  question: string;
  options: PollOption[];
  duration: number; // in hours
}

export interface PollResult {
  messageId: string;
  selectedOptionId: string;
  selectedBy: {
    id: string;
    username: string;
  };
}

const log = createLogger('DISCORD:API');

export async function sendMessage(
  client: Client,
  channelId: string,
  options: SendMessageOptions
): Promise<void> {
  log.info(`sendMessage to ${channelId}, content length: ${options.content.length}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    log.error(`Channel ${channelId} not found or not text-based`);
    throw new Error(`Invalid channel: ${channelId}`);
  }

  const messageOptions: {
    content: string;
    files?: AttachmentBuilder[];
  } = {
    content: options.content,
  };

  if (options.files && options.files.length > 0) {
    log.info(`Attaching ${options.files.length} files`);
    messageOptions.files = options.files.map(
      (f) => new AttachmentBuilder(f.data, { name: f.name })
    );
  }

  await (channel as TextChannel | ThreadChannel).send(messageOptions);
  log.info(`Message sent to ${channelId}`);
}

export async function sendMessageChunks(
  client: Client,
  channelId: string,
  content: string,
  maxLength: number = 1900
): Promise<void> {
  log.info(`sendMessageChunks to ${channelId}, total length: ${content.length}`);

  const chunks = splitContent(content, maxLength);
  log.info(`Split into ${chunks.length} chunks`);

  for (let i = 0; i < chunks.length; i++) {
    log.info(`Sending chunk ${i + 1}/${chunks.length}`);
    await sendMessage(client, channelId, { content: chunks[i] });

    if (i < chunks.length - 1) {
      await sleep(1500);
    }
  }

  log.info(`All ${chunks.length} chunks sent`);
}

export async function createThread(
  client: Client,
  channelId: string,
  messageId: string,
  name: string
): Promise<ThreadChannel> {
  log.info(`createThread from message ${messageId}, name: ${name}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    log.error(`Channel ${channelId} not found or not a text channel`);
    throw new Error(`Invalid channel for thread creation: ${channelId}`);
  }

  const textChannel = channel as TextChannel;
  const message = await textChannel.messages.fetch(messageId);

  const thread = await message.startThread({
    name: name.substring(0, 100),
    autoArchiveDuration: 1440,
  });

  log.info(`Thread created: ${thread.id}`);
  return thread;
}

export async function getChannel(client: Client, channelId: string): Promise<ChannelInfo> {
  log.info(`getChannel ${channelId}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel) {
    log.error(`Channel ${channelId} not found`);
    throw new Error(`Channel not found: ${channelId}`);
  }

  const info: ChannelInfo = {
    id: channel.id,
    name: 'name' in channel ? (channel.name as string) : 'unknown',
    type: channel.type,
    parent_id: 'parentId' in channel ? (channel.parentId as string | null) : null,
  };

  log.info(`Channel info: type=${info.type}, name=${info.name}`);
  return info;
}

export async function getMessages(
  client: Client,
  channelId: string,
  limit: number = 50
): Promise<Array<{
  id: string;
  content: string;
  author: { id: string; username: string; bot: boolean; global_name?: string };
  attachments: Array<{ id: string; filename: string; url: string; content_type?: string; size: number }>;
  timestamp: string;
  mentions: Array<{ id: string; username: string }>;
}>> {
  log.info(`getMessages from ${channelId}, limit: ${limit}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    log.error(`Channel ${channelId} not found or not text-based`);
    throw new Error(`Invalid channel: ${channelId}`);
  }

  const messages = await (channel as TextChannel | ThreadChannel).messages.fetch({ limit });
  log.info(`Fetched ${messages.size} messages`);

  return Array.from(messages.values()).map((msg) => ({
    id: msg.id,
    content: msg.content,
    author: {
      id: msg.author.id,
      username: msg.author.username,
      bot: msg.author.bot,
      global_name: msg.author.globalName || undefined,
    },
    attachments: Array.from(msg.attachments.values()).map((att) => ({
      id: att.id,
      filename: att.name,
      url: att.url,
      content_type: att.contentType || undefined,
      size: att.size,
    })),
    timestamp: msg.createdAt.toISOString(),
    mentions: Array.from(msg.mentions.users.values()).map((u) => ({
      id: u.id,
      username: u.username,
    })),
    embeds: msg.embeds.map((embed) => ({
      title: embed.title || undefined,
      description: embed.description || undefined,
    })),
  }));
}

function splitContent(content: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = maxLength;
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > maxLength * 0.7) {
      splitPoint = lastNewline + 1;
    }

    chunks.push(remaining.substring(0, splitPoint));
    remaining = remaining.substring(splitPoint);
  }

  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a Discord poll with the given options
 * Discord polls don't have a native API for programmatic vote detection,
 * so we'll use reactions as a fallback mechanism
 */
export async function createPoll(
  client: Client,
  channelId: string,
  options: CreatePollOptions
): Promise<string> {
  log.info(`createPoll in ${channelId}, question: ${options.question}`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    log.error(`Channel ${channelId} not found or not text-based`);
    throw new Error(`Invalid channel: ${channelId}`);
  }

  // Format options for Discord (A, B, C, D, etc.)
  const reactionEmojis = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
  
  let content = `**${options.question}**\n\n`;
  options.options.forEach((opt, idx) => {
    content += `${reactionEmojis[idx]} **${opt.label}**\n`;
    content += `   ${opt.description}\n\n`;
  });
  content += `\n*Vote with the corresponding reaction. First vote wins!*`;

  const message = await (channel as TextChannel | ThreadChannel).send({ content });
  log.info(`Poll created with message ID: ${message.id}`);

  // Add reaction options
  for (let i = 0; i < options.options.length; i++) {
    await message.react(reactionEmojis[i]);
    await sleep(500); // Small delay between reactions
  }

  return message.id;
}

/**
 * Wait for the first vote on a poll message
 * Returns the selected option index (0-based) and user info
 */
export async function waitForPollVote(
  client: Client,
  channelId: string,
  messageId: string,
  optionCount: number,
  timeoutMs: number = 300000 // 5 minutes default
): Promise<PollResult | null> {
  log.info(`waitForPollVote on message ${messageId}, timeout: ${timeoutMs}ms`);

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    log.error(`Channel ${channelId} not found or not text-based`);
    return null;
  }

  const reactionEmojis = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭', '🇮', '🇯'];
  const message = await (channel as TextChannel | ThreadChannel).messages.fetch(messageId);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      log.info(`Poll timeout reached for message ${messageId}`);
      resolve(null);
    }, timeoutMs);

    // Check for reactions every 2 seconds
    const checkInterval = setInterval(async () => {
      try {
        const freshMessage = await (channel as TextChannel | ThreadChannel).messages.fetch(messageId);
        const reactions = freshMessage.reactions.cache;

        for (let i = 0; i < optionCount; i++) {
          const emoji = reactionEmojis[i];
          const reaction = reactions.find(r => r.emoji.name === emoji);
          
          if (reaction) {
            const users = await reaction.users.fetch();
            const nonBotUsers = users.filter(u => !u.bot);
            
            if (nonBotUsers.size > 0) {
              const firstUser = nonBotUsers.first()!;
              clearTimeout(timer);
              clearInterval(checkInterval);
              
              log.info(`Poll vote received: option ${i} (${emoji}) by ${firstUser.username}`);
              resolve({
                messageId,
                selectedOptionId: String.fromCharCode(65 + i), // A, B, C, etc.
                selectedBy: {
                  id: firstUser.id,
                  username: firstUser.username,
                },
              });
              return;
            }
          }
        }
      } catch (error) {
        log.error(`Error checking poll reactions: ${error}`);
      }
    }, 2000);
  });
}
