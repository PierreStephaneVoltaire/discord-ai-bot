import { ChannelType } from 'discord.js';
import { getDiscordClient, getChannel } from '../modules/discord/index';
import { createLogger } from '../utils/logger';
import type { DiscordMessagePayload } from '../modules/discord/types';
import type { ThreadContext } from './types';

const log = createLogger('THREAD');

const CHANNEL_TYPE_NAMES: Record<number, string> = {
  0: 'GUILD_TEXT',
  11: 'GUILD_PUBLIC_THREAD',
  12: 'GUILD_PRIVATE_THREAD',
};

export async function detectThread(
  message: DiscordMessagePayload
): Promise<ThreadContext> {
  log.info('Detecting thread context');

  const client = getDiscordClient();
  const channelInfo = await getChannel(client, message.channel_id);

  const channelType = channelInfo.type;
  const typeName = CHANNEL_TYPE_NAMES[channelType] || `UNKNOWN(${channelType})`;
  log.info(`Channel type: ${channelType} (${typeName})`);

  const isThreadChannel =
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread;

  const hasThread = !!message.thread;

  const isThread = isThreadChannel || hasThread;
  log.info(`Is thread: ${isThread}`);

  let threadId: string | null = null;
  if (isThreadChannel) {
    threadId = message.channel_id;
  } else if (hasThread) {
    threadId = message.thread!.id;
  }

  log.info(`Thread ID: ${threadId || 'none'}`);
  log.info(`Parent ID: ${channelInfo.parent_id || 'none'}`);

  return {
    is_thread: isThread,
    thread_id: threadId,
    channel_id: message.channel_id,
    channel_name: channelInfo.name,
    channel_type: channelType,
    parent_id: channelInfo.parent_id,
  };
}

export function isGeneralChannel(channelName: string): boolean {
  return channelName.toLowerCase() === 'general';
}

export function shouldProcess(thread: ThreadContext): boolean {
  return thread.is_thread || isGeneralChannel(thread.channel_name);
}
