import { ChannelType } from 'discord.js';
import { getDiscordClient, getChannel } from '../modules/discord/index';
import { getChatClient } from '../modules/chat';
import type { ChannelInfo } from '../modules/discord/types';
import type { ChatChannel } from '../modules/chat/types';
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

  const chatClient = getChatClient();
  const channelInfo = (chatClient
    ? await chatClient.getChannel(message.channel_id)
    : await getChannel(getDiscordClient(), message.channel_id)) as (ChatChannel | ChannelInfo | null);

  const channelType = typeof channelInfo?.type === 'number' ? channelInfo.type : 0;
  const typeName = CHANNEL_TYPE_NAMES[channelType] || `UNKNOWN(${channelType})`;
  log.info(`Channel type: ${channelType} (${typeName})`);

  const isThreadChannel =
    channelType === ChannelType.PublicThread ||
    channelType === ChannelType.PrivateThread;

  log.info(`Thread detection: channelType=${channelType}, PublicThread=${ChannelType.PublicThread}, PrivateThread=${ChannelType.PrivateThread}`);
  log.info(`isThreadChannel=${isThreadChannel}`);

  const hasThread = !!message.thread;
  log.info(`hasThread property=${hasThread}`);

  const isThread = isThreadChannel || hasThread;
  log.info(`Final is_thread=${isThread}`);

  let threadId: string | null = null;
  if (isThreadChannel) {
    threadId = message.channel_id;
  } else if (hasThread) {
    threadId = message.thread!.id;
  }

  log.info(`Thread ID: ${threadId || 'none'}`);
  const parentId = (channelInfo as { parent_id?: string | null; parentId?: string | null } | null)?.parent_id
    ?? (channelInfo as { parent_id?: string | null; parentId?: string | null } | null)?.parentId
    ?? null;
  log.info(`Parent ID: ${parentId || 'none'}`);

  return {
    is_thread: isThread,
    thread_id: threadId,
    channel_id: message.channel_id,
    channel_name: channelInfo?.name || 'unknown',
    channel_type: channelType,
    parent_id: parentId,
  };
}

export function isGeneralChannel(channelName: string): boolean {
  return channelName.toLowerCase() === 'general';
}

export function shouldProcess(thread: ThreadContext): boolean {
  return thread.is_thread || isGeneralChannel(thread.channel_name);
}
