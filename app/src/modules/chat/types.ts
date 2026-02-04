/**
 * Chat Platform Abstraction Types
 * Defines the common interface for Discord and Stoat adapters
 */

export interface ChatAttachment {
  id: string;
  filename: string;
  url: string;
  contentType?: string;
  size: number;
}

export interface ChatMention {
  id: string;
  username: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  guildId: string | null;
  content: string;
  author: {
    id: string;
    username: string;
    bot: boolean;
    displayName?: string;
  };
  attachments: ChatAttachment[];
  mentions: ChatMention[];
  timestamp: string;
  replyTo?: {
    channelId: string;
    messageId: string;
  };
  thread?: {
    id: string;
    name: string;
  };
}

export interface ChatReaction {
  messageId: string;
  channelId: string;
  emoji: string;
  userId: string;
}

export interface SendMessageOptions {
  content: string;
  files?: Array<{
    name: string;
    data: Buffer;
  }>;
}

export interface ChatThread {
  id: string;
  name: string;
  channelId: string;
}

export interface ChatChannel {
  id: string;
  name: string;
  type: 'text' | 'thread' | 'dm';
  parentId?: string;
}

/**
 * Abstract interface for chat platform clients
 * Both Discord and Stoat implement this interface
 */
export interface ChatClient {
  // Lifecycle
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;

  // Event handlers
  onMessage: (handler: (message: ChatMessage) => Promise<void>) => void;
  onReaction: (handler: (reaction: ChatReaction) => Promise<void>) => void;
  onReady: (handler: () => Promise<void>) => void;
  onThreadDelete: (handler: (threadId: string) => Promise<void>) => void;

  // Actions
  sendMessage: (channelId: string, options: SendMessageOptions) => Promise<void>;
  sendMessageChunks: (channelId: string, content: string, maxLength?: number) => Promise<void>;
  getHistory: (channelId: string, limit?: number) => Promise<ChatMessage[]>;
  addReaction: (channelId: string, messageId: string, emoji: string) => Promise<void>;
  createThread: (channelId: string, messageId: string, name: string) => Promise<ChatThread>;
  getChannel: (channelId: string) => Promise<ChatChannel | null>;

  // Platform info
  platform: 'discord' | 'stoat';
  botUserId: string;
  botUsername: string;
  isReady: boolean;
}

/**
 * Configuration for creating a chat client
 */
export interface ChatClientConfig {
  platform: 'discord' | 'stoat';
  discordToken?: string;
  discordBotId?: string;
  stoatToken?: string;
  stoatBotId?: string;
}
