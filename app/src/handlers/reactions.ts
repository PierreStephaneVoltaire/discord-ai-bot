import { createLogger } from '../utils/logger';
import { getDiscordClient } from '../modules/discord/index';
import { abortLock } from '../modules/agentic/lock';
import { setAbortFlag } from '../modules/redis';
import { getCommitMessage, removeCommitMessage, mergeBranch, deleteBranch } from '../modules/agentic/commits';
import { emitBranchMerged, emitBranchRejected, emitExecutionAborted } from '../modules/agentic/events';
import { Client, MessageReaction, User, PartialMessageReaction, PartialUser } from 'discord.js';

const log = createLogger('HANDLERS:REACTIONS');

/**
 * Handles emoji reactions on messages
 * This is APPLICATION CODE - NO LLM involvement
 */
export async function handleReactionAdd(
  reaction: any,
  user: any
): Promise<void> {
  // Ignore bot reactions
  if (user.bot) {
    return;
  }

  const emoji = reaction.emoji.name;
  const message = reaction.message;

  log.info(`Reaction ${emoji} added by ${user.username} to message ${message.id}`);

  // Handle commit message reactions
  const commitMetadata = getCommitMessage(message.id);
  if (commitMetadata) {
    await handleCommitReaction(emoji, message, commitMetadata, user);
    return;
  }

  // Handle execution start message reactions (🛑 to abort)
  if (emoji === '🛑') {
    await handleAbortReaction(message, user);
    return;
  }

  log.debug(`No handler for reaction ${emoji} on message ${message.id}`);
}

/**
 * Handles reactions on commit messages
 */
async function handleCommitReaction(
  emoji: string,
  message: any,
  metadata: { branch: string; commitHash: string; type: 'commit' },
  user: any
): Promise<void> {
  const { branch, commitHash } = metadata;

  if (emoji === '👍') {
    log.info(`User ${user.username} approved commit for branch ${branch}`);
    
    try {
      await mergeBranch(branch);
      
      log.info(`Branch ${branch} merged`);
      
      // Emit event
      await emitBranchMerged({
        threadId: message.channelId,
        branch,
      });

      // Delete the commit message
      await message.delete();
      removeCommitMessage(message.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to merge branch ${branch}: ${errorMessage}`);
      await message.reply(`❌ Failed to merge branch: ${errorMessage}`);
    }
  } else if (emoji === '👎') {
    log.info(`User ${user.username} rejected commit for branch ${branch}`);
    
    try {
      await deleteBranch(branch);
      
      log.info(`Branch ${branch} deleted`);
      
      // Emit event
      await emitBranchRejected({
        threadId: message.channelId,
        branch,
      });

      // Delete the commit message
      await message.delete();
      removeCommitMessage(message.id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Failed to delete branch ${branch}: ${errorMessage}`);
      await message.reply(`❌ Failed to delete branch: ${errorMessage}`);
    }
  }
}

/**
 * Handles abort reactions on execution start messages
 */
async function handleAbortReaction(message: any, user: any): Promise<void> {
  // Check if this is an execution start message
  // We can identify this by checking the embed or message content
  const isExecutionStart = message.embeds?.some((embed: any) =>
    embed.title?.includes('Starting work') || embed.description?.includes('execution')
  );

  if (!isExecutionStart) {
    return;
  }

  log.info(`User ${user.username} requested abort for execution in channel ${message.channelId}`);

  // Set abort flag on Redis (fallback to in-memory)
  await setAbortFlag(message.channelId);
  abortLock(message.channelId);

  // Send confirmation message
  await message.channel.send('⏹️ Execution stop requested. Will halt at next turn.');
}

/**
 * Sets up reaction handlers on Discord client
 */
export function setupReactionHandlers(client: Client): void {
  client.on('messageReactionAdd', async (reaction, user) => {
    try {
      await handleReactionAdd(reaction, user);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Error handling reaction: ${errorMessage}`);
    }
  });
  
  log.info('Reaction handlers registered');
}
