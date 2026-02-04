import { EmbedBuilder, TextChannel, ThreadChannel, Message } from 'discord.js';
import { getDiscordClient } from '../discord/index';
import { getChatClient } from '../chat';
import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:PROGRESS');

export interface ProgressUpdate {
  type: 'turn_start' | 'turn_complete' | 'tool_execution' | 'checkpoint' | 'escalation' | 'clarification_request' |
  'planning' | 'should_respond' | 'reflection' | 'branching' | 'prompt_ready';
  turnNumber?: number;
  maxTurns?: number;
  confidence?: number;
  model?: string;
  filesModified?: number;
  status?: string;
  tool?: string;
  args?: any;
  checkpointData?: any;
  escalationReason?: string;
  newModel?: string;
  clarificationMessage?: string;
  phase?: string;
  branchingPhase?: string;
  promptPreview?: string;
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * Streams progress updates to Discord thread
 */
/**
 * Posts a commit message to Discord with reaction options
 */
export async function postCommitMessage(
  threadId: string,
  commit: { message: string; branch: string; commitHash: string; files: string[] }
): Promise<string> {
  try {
    const client = getDiscordClient();
    const channel = await client.channels.fetch(threadId);

    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${threadId} is not text-based`);
    }

    const textChannel = channel as TextChannel | ThreadChannel;

    const embed = new EmbedBuilder()
      .setTitle(`📝 Commit: ${commit.message}`)
      .setDescription(
        `**Branch:** \`${commit.branch}\`\n` +
        `**Files:** ${commit.files.join(', ') || 'None'}\n` +
        `**Hash:** \`${commit.commitHash.substring(0, 7)}\``
      )
      .setFooter({ text: '👍 to merge | 👎 to reject' })
      .setColor(0x00ff00)
      .setTimestamp();

    const message = await textChannel.send({ embeds: [embed] });

    // Add reaction options
    await message.react('👍');
    await message.react('👎');

    log.info(`Posted commit message ${message.id} for branch ${commit.branch}`);
    return message.id;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Failed to post commit message: ${errorMessage}`);
    throw error;
  }
}

export async function streamProgressToDiscord(
  threadId: string,
  update: ProgressUpdate
): Promise<void> {
  try {
  const chatClient = getChatClient();
    if (chatClient && chatClient.platform !== 'discord') {
      const summary = update.clarificationMessage
        || update.promptPreview
        || update.phase
        || update.status
        || update.type;
      await chatClient.sendMessage(threadId, {
        content: `**${update.type}** ${summary ? `- ${summary}` : ''}`,
      });
      return;
    }

    const client = getDiscordClient();
    const channel = await client.channels.fetch(threadId);

    if (!channel || (!channel.isTextBased() && !(channel instanceof ThreadChannel))) {
      log.warn(`Channel ${threadId} not found or not text-based`);
      return;
    }

    const textChannel = channel as TextChannel | ThreadChannel;

    switch (update.type) {
      case 'turn_start': {
        const embed = new EmbedBuilder()
          .setColor(0x5865F2) // Discord blurple
          .setTitle(`🤔 Turn ${update.turnNumber}/${update.maxTurns}`)
          .addFields(
            { name: 'Confidence', value: `${update.confidence}%`, inline: true },
            { name: 'Model', value: update.model || 'Unknown', inline: true }
          )
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info(`Turn ${update.turnNumber}/${update.maxTurns} started with model ${update.model || 'Unknown'}`);
        break;
      }

      case 'tool_execution': {
        const argsPreview = update.args
          ? JSON.stringify(update.args).substring(0, 100) + (JSON.stringify(update.args).length > 100 ? '...' : '')
          : 'No args';

        const embed = new EmbedBuilder()
          .setColor(0xFEE75C) // Yellow
          .setTitle(`🔧 Executing Tool`)
          .addFields(
            { name: 'Tool', value: update.tool || 'Unknown', inline: false },
            { name: 'Arguments', value: `\`\`\`json\n${argsPreview}\n\`\`\``, inline: false }
          )
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info(`Executing tool: ${update.tool}`);
        break;
      }

      case 'turn_complete': {
        const confidence = update.confidence || 0;
        const color = confidence > 70 ? 0x57F287 : confidence > 50 ? 0xFEE75C : 0xED4245; // Green/Yellow/Red
        const emoji = confidence > 70 ? '✅' : confidence > 50 ? '⚠️' : '❌';

        const embed = new EmbedBuilder()
          .setColor(color)
          .setTitle(`${emoji} Turn ${update.turnNumber} Complete`)
          .addFields(
            { name: 'Confidence', value: `${confidence}%`, inline: true },
            { name: 'Files Modified', value: `${update.filesModified || 0}`, inline: true },
            { name: 'Status', value: update.status || 'Unknown', inline: true },
            { name: 'Model', value: update.model || 'Unknown', inline: true }
          )
          .setTimestamp();

        // Add token usage if available
        if (update.inputTokens !== undefined || update.outputTokens !== undefined) {
          const inputTokens = update.inputTokens || 0;
          const outputTokens = update.outputTokens || 0;
          const totalTokens = inputTokens + outputTokens;
          embed.addFields({
            name: 'Tokens',
            value: `In: ${inputTokens.toLocaleString()} | Out: ${outputTokens.toLocaleString()} | Total: ${totalTokens.toLocaleString()}`,
            inline: false
          });
        }

        await textChannel.send({ embeds: [embed] });
        log.info(`Turn ${update.turnNumber} complete with model ${update.model || 'Unknown'}`);
        break;
      }

      case 'checkpoint': {
        const data = update.checkpointData || {};
        const isFinal = data.totalTurns !== undefined && data.turnNumber >= data.totalTurns;
        const embed = new EmbedBuilder()
          .setColor(0x5865F2)
          .setTitle(isFinal ? `🏁 Execution Complete` : `💾 Checkpoint ${data.turnNumber}/${data.totalTurns}`)
          .setDescription(isFinal ? `Execution finished after ${data.turnNumber} turns` : `Progress saved at turn ${data.turnNumber}`)
          .addFields(
            { name: 'Files Modified', value: `${data.filesModified || 0}`, inline: true },
            { name: 'Confidence', value: `${data.confidence || 0}%`, inline: true }
          )
          .setTimestamp();

        // Add model info if available
        if (data.finalModel) {
          embed.addFields({ name: 'Final Model', value: data.finalModel, inline: true });
        }

        // Add token usage if available (for final checkpoint)
        if (data.totalTokens !== undefined) {
          embed.addFields({
            name: 'Total Token Usage',
            value: `In: ${(data.totalInputTokens || 0).toLocaleString()} | Out: ${(data.totalOutputTokens || 0).toLocaleString()} | Total: ${data.totalTokens.toLocaleString()}`,
            inline: false
          });
        }

        await textChannel.send({ embeds: [embed] });
        log.info(`${isFinal ? 'Final checkpoint' : 'Checkpoint'} at turn ${data.turnNumber}`);
        break;
      }

      case 'escalation': {
        const embed = new EmbedBuilder()
          .setColor(0xEB459E) // Pink/Purple
          .setTitle(`🚀 Model Escalation`)
          .setDescription(`Escalating from **${update.model}** to **${update.newModel}**`)
          .addFields(
            { name: 'Reason', value: update.escalationReason || 'Unknown', inline: false },
            { name: 'Turn', value: `${update.turnNumber}`, inline: true }
          )
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.warn(`Escalated: ${update.model} → ${update.newModel}`);
        break;
      }

      case 'clarification_request': {
        const embed = new EmbedBuilder()
          .setColor(0xFEE75C) // Yellow
          .setTitle(`💬 Clarification Needed`)
          .setDescription(update.clarificationMessage || 'Need your help to proceed')
          .addFields(
            { name: 'Confidence', value: `${update.confidence || 0}%`, inline: true },
            { name: 'Turn', value: `${update.turnNumber}`, inline: true }
          )
          .setFooter({ text: 'React with 🛑 to stop, 💬 to clarify, 🔄 to retry, or ✅ to continue' })
          .setTimestamp();

        const message = await textChannel.send({ embeds: [embed] });

        // Add reaction buttons for user interaction
        await message.react('🛑'); // STOP
        await message.react('💬'); // CLARIFY
        await message.react('🔄'); // RETRY
        await message.react('✅'); // CONTINUE

        log.warn(`Clarification requested at turn ${update.turnNumber}`);
        break;
      }

      case 'planning':
      case 'should_respond': {
        const emoji = update.type === 'planning' ? '📋' : '🤔';
        const title = update.type === 'planning' ? 'Planning' : 'Deciding';

        const embed = new EmbedBuilder()
          .setColor(0x9B59B6) // Purple
          .setTitle(`${emoji} ${title}`)
          .setDescription(`Using **${update.model}**`)
          .addFields(
            { name: 'Phase', value: update.phase || 'Processing', inline: true }
          )
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info(`${title} phase started with model ${update.model}`);
        break;
      }

      case 'reflection': {
        const embed = new EmbedBuilder()
          .setColor(0x3498DB) // Blue
          .setTitle(`🔍 Reflection Review`)
          .setDescription(`Evaluating execution trajectory using **${update.model || 'default model'}**`)
          .addFields(
            { name: 'Previous Score', value: `${update.confidence}%`, inline: true }
          )
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info(`Reflection review started with model ${update.model || 'default model'}`);
        break;
      }

      case 'branching': {
        const emoji = update.branchingPhase === 'consolidator' ? '🧠' : '💡';
        const modelName = update.model || 'Unknown';
        const phaseDisplay = {
          'model1': `Brainstorming (${modelName})`,
          'model2': `Brainstorming (${modelName})`,
          'consolidator': `Consolidating (${modelName})`
        }[update.branchingPhase || 'model1'] || `Brainstorming (${modelName})`;

        const embed = new EmbedBuilder()
          .setColor(0xE74C3C) // Red
          .setTitle(`${emoji} Branching`)
          .setDescription(phaseDisplay)
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info(`Branching phase: ${update.branchingPhase} with model ${modelName}`);
        break;
      }

      case 'prompt_ready': {
        const embed = new EmbedBuilder()
          .setColor(0x2ECC71) // Green
          .setTitle(`✅ Task Ready`)
          .setDescription(update.promptPreview || 'Reformulated prompt ready for execution')
          .setTimestamp();

        await textChannel.send({ embeds: [embed] });
        log.info('Reformulated prompt ready');
        break;
      }

      default:
        log.debug(`Unknown progress update type: ${update.type}`);
    }
  } catch (error) {
    log.error('Failed to send progress update to Discord', { error, threadId, updateType: update.type });
  }
}

/**
 * Formats checkpoint data for Discord display
 */
export function formatCheckpointMessage(
  turnNumber: number,
  maxTurns: number,
  confidence: number,
  filesModified: number,
  fileList: string[]
): string {
  const fileListStr = fileList.length > 0
    ? fileList.slice(0, 5).join(', ') + (fileList.length > 5 ? `, +${fileList.length - 5} more` : '')
    : 'No files modified yet';

  return `💾 **Checkpoint ${turnNumber}/${maxTurns}**
Progress: ${filesModified} files modified
Files: ${fileListStr}
Confidence: ${confidence}%`;
}

/**
 * Formats clarification request for Discord
 */
export function formatClarificationRequest(
  reason: string,
  confidence: number,
  turnNumber: number
): string {
  return `💬 **Need Your Help** (Turn ${turnNumber})

I'm having trouble and need clarification:
${reason}

Current confidence: ${confidence}%

Please provide guidance or use these reactions:
🛑 Stop execution
💬 Provide clarification
🔄 Retry with different approach
✅ Continue anyway`;
}
