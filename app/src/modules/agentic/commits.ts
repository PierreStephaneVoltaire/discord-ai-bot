import { createLogger } from '../../utils/logger';
import { getDiscordClient } from '../discord/index';
import { EmbedBuilder, TextChannel, NewsChannel, ThreadChannel } from 'discord.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const log = createLogger('AGENTIC:COMMITS');
const execAsync = promisify(exec);

export interface CommitInfo {
  message: string;
  branch: string;
  files: string[];
  commitHash: string;
}

// Store message ID → branch mapping for reaction handler
const commitMessages = new Map<string, { branch: string; commitHash: string; type: 'commit' }>();

/**
 * Posts a commit message to Discord with reaction instructions
 */
export async function postCommitMessage(
  threadId: string,
  commit: CommitInfo
): Promise<string> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(threadId);
    
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${threadId} is not text-based`);
    }

    // Type guard to ensure channel supports send
    if (!('send' in channel)) {
      throw new Error(`Channel ${threadId} does not support sending messages`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`📝 Commit: ${commit.message}`)
      .setDescription(
        `**Branch:** \`${commit.branch}\`\n` +
        `**Files:** ${commit.files.join(', ') || 'None'}\n` +
        `**Hash:** \`${commit.commitHash}\``
      )
      .setFooter({ text: '👍 to merge | 👎 to reject' })
      .setColor(0x00ff00);

    const message = await channel.send({ embeds: [embed] });

    // Store metadata for reaction handler
    commitMessages.set(message.id, {
      branch: commit.branch,
      commitHash: commit.commitHash,
      type: 'commit',
    });

    log.info(`Posted commit message ${message.id} for branch ${commit.branch}`);
    return message.id;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to post commit message: ${errorMessage}`);
    throw error;
  }
}

/**
 * Registers a commit message for reaction handling
 */
export function registerCommitMessage(messageId: string, metadata: { branch: string; commitHash: string }): void {
  commitMessages.set(messageId, { ...metadata, type: 'commit' });
  log.info(`Registered commit message ${messageId} for branch ${metadata.branch}`);
}

/**
 * Gets commit metadata for a message
 */
export function getCommitMessage(messageId: string): { branch: string; commitHash: string; type: 'commit' } | undefined {
  return commitMessages.get(messageId);
}

/**
 * Removes commit metadata after handling
 */
export function removeCommitMessage(messageId: string): void {
  commitMessages.delete(messageId);
  log.info(`Unregistered commit message ${messageId}`);
}

/**
 * Merges a branch into main
 */
export async function mergeBranch(branch: string): Promise<void> {
  log.info(`Merging branch ${branch}`);
  
  try {
    // Get current branch
    const { stdout: currentBranch } = await execAsync('git branch --show-current');
    const mainBranch = currentBranch.trim();
    
    // Checkout main if not already there
    if (mainBranch !== 'main' && mainBranch !== 'master') {
      await execAsync('git checkout main || git checkout master');
    }
    
    // Merge the feature branch
    await execAsync(`git merge ${branch} --no-ff -m "Merge branch '${branch}'"`);
    
    // Delete the feature branch
    await execAsync(`git branch -d ${branch}`);
    
    log.info(`Successfully merged and deleted branch ${branch}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to merge branch ${branch}: ${errorMessage}`);
    throw error;
  }
}

/**
 * Deletes a branch without merging
 */
export async function deleteBranch(branch: string): Promise<void> {
  log.info(`Deleting branch ${branch}`);
  
  try {
    // Get current branch
    const { stdout: currentBranch } = await execAsync('git branch --show-current');
    
    // If we're on the branch to delete, checkout main first
    if (currentBranch.trim() === branch) {
      await execAsync('git checkout main || git checkout master');
    }
    
    // Force delete the branch
    await execAsync(`git branch -D ${branch}`);
    
    log.info(`Successfully deleted branch ${branch}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to delete branch ${branch}: ${errorMessage}`);
    throw error;
  }
}
