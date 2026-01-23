import type { Message, TextChannel, ThreadChannel, ChannelType } from 'discord.js';

export interface DiscordMessagePayload {
  id: string;
  channel_id: string;
  guild_id: string | null;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
    global_name?: string;
  };
  attachments: DiscordAttachment[];
  mentions: DiscordMention[];
  timestamp: string;
  message_reference?: {
    channel_id: string;
    message_id: string;
  };
  thread?: {
    id: string;
    name: string;
  };
}

export interface DiscordAttachment {
  id: string;
  filename: string;
  url: string;
  proxy_url?: string;
  content_type?: string;
  size: number;
}

export interface DiscordMention {
  id: string;
  username: string;
  global_name?: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: ChannelType;
  parent_id: string | null;
}

export interface ThreadContext {
  is_thread: boolean;
  thread_id: string | null;
  channel_id: string;
  channel_name: string;
  channel_type: number;
  parent_id: string | null;
}

export interface SendMessageOptions {
  content: string;
  files?: Array<{
    name: string;
    data: Buffer;
  }>;
}

export { Message, TextChannel, ThreadChannel };
