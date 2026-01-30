import type { Client, Message, MessageReaction, User, PartialMessageReaction, PartialUser, ThreadChannel, Interaction } from 'discord.js';
import { createLogger } from '../../utils/logger';
import type { DiscordMessagePayload } from './types';
import { updateSessionConfidence, deleteSession } from '../dynamodb/sessions';
import { workspaceManager } from '../workspace/manager';
import { s3Sync } from '../workspace/s3-sync';
import { registerSlashCommands, handleSlashCommand } from './slash-commands';

const log = createLogger('DISCORD:EVENT');

export type MessageHandler = (payload: DiscordMessagePayload) => Promise<void>;

export function setupEventHandlers(client: Client, onMessage: MessageHandler): void {
  log.info('Setting up event handlers');

  client.on('ready', async () => {
    log.info(`on_ready triggered`);
    log.info(`Gateway connected as ${client.user?.username} (ID: ${client.user?.id})`);

    // Register slash commands when bot is ready
    try {
      await registerSlashCommands(client);
    } catch (error) {
      log.error('Failed to register slash commands:', { error: String(error) });
    }
  });

  // Handle slash command interactions
  client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;

    try {
      await handleSlashCommand(interaction);
    } catch (error) {
      log.error('Error handling slash command:', { error: String(error) });

      // Try to respond with error if not already responded
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your command.',
          ephemeral: true,
        }).catch(() => {
          // Ignore if we can't reply
        });
      }
    }
  });

  client.on('messageCreate', async (message: Message) => {
    log.info(`on_message: ${message.id} in channel ${message.channel.id}`);

    if (message.author.bot) return;

    const payload = messageToPayload(message);

    try {
      await onMessage(payload);
    } catch (error) {
      log.error(`Error processing message ${message.id}`, { error: String(error) });
    }
  });

  client.on('messageReactionAdd', async (reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser) => {
    if (user.bot) return;

    // Handle partials
    if (reaction.partial) {
      try {
        await reaction.fetch();
      } catch (error) {
        log.error('Something went wrong when fetching the reaction:', { error: String(error) });
        return;
      }
    }

    const threadId = reaction.message.channelId;
    const emoji = reaction.emoji.name;

    if (emoji === '👍') {
      log.info(`Positive feedback received for thread ${threadId}`);
      await updateSessionConfidence(threadId, 15);
    } else if (emoji === '👎') {
      log.info(`Negative feedback received for thread ${threadId}`);
      await updateSessionConfidence(threadId, -20);
    }
  });

  client.on('threadDelete', async (thread: ThreadChannel) => {
    log.info(`Thread deleted: ${thread.id}. Cleaning up resources...`);

    try {
      // 1. Cleanup Workspace
      await workspaceManager.deleteWorkspace(thread.id);

      // 2. Cleanup S3
      await s3Sync.deletePrefix(thread.id);

      // 3. Cleanup DynamoDB
      await deleteSession(thread.id);

      log.info(`Cleanup completed for thread ${thread.id}`);
    } catch (err) {
      log.error(`Cleanup failed for thread ${thread.id}`, { error: String(err) });
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
