import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  AttachmentBuilder,
  REST,
  Routes,
  Client,
} from 'discord.js';
import { getLock, hasActiveLock } from '../agentic/lock';
import { checkAbortFlag, checkLock, getThreadState, getCachedSession } from '../redis';
import { getSession, updateSession } from '../dynamodb/sessions';
import { listS3Files, formatFileTree, deleteS3Prefix, getS3File } from '../workspace/s3-helpers';
import { workspaceManager } from '../workspace/manager';
import { s3Sync } from '../workspace/s3-sync';
import {
  getExecutionSummaries,
  getConfidenceHistory,
  getEscalationHistory,
  formatTimestamp,
  getOutcomeEmoji,
} from '../dynamodb/queries';
import { FlowType } from '../litellm/types';
import type { Session } from '../dynamodb/types';
import { createLogger } from '../../utils/logger';
import { getConfig } from '../../config/index';

const log = createLogger('DISCORD:SLASH_COMMANDS');

// Command definitions
export const slashCommands = [
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show current execution state for the thread'),

  new SlashCommandBuilder()
    .setName('workspace')
    .setDescription('Manage workspace files')
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List files in S3 workspace')
        .addStringOption((option) =>
          option
            .setName('thread_name')
            .setDescription('Optional thread name to list files from')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('sync').setDescription('Force S3 sync for current thread workspace')
    )
    .addSubcommand((sub) =>
      sub
        .setName('clean')
        .setDescription('Delete all files in current thread workspace (Admin only)')
    )
    .addSubcommand((sub) =>
      sub
        .setName('upload')
        .setDescription('Upload a specific file from S3 workspace to Discord')
        .addStringOption((option) =>
          option
            .setName('file_path')
            .setDescription('Relative file path (e.g., src/index.ts)')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('flow')
    .setDescription('Force a specific execution flow for next task')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Execution flow type')
        .setRequired(true)
        .addChoices(
          { name: 'Sequential', value: 'sequential' },
          { name: 'Branch', value: 'branch' },
          { name: 'Simple', value: 'simple' },
          { name: 'Breakglass', value: 'breakglass' }
        )
    ),

  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Show recent execution logs from DynamoDB')
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription('Number of logs to show (default: 5)')
        .setMinValue(1)
        .setMaxValue(20)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('confidence')
    .setDescription('Show current and historical confidence scores'),

  new SlashCommandBuilder()
    .setName('escalation')
    .setDescription('Show escalation history for thread'),
];

/**
 * Register slash commands with Discord
 */
export async function registerSlashCommands(client: Client): Promise<void> {
  const config = getConfig();
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

  try {
    log.info('Registering slash commands...');

    const commandsData = slashCommands.map((cmd) => cmd.toJSON());

    // Register globally or to specific guild for testing
    if (config.DISCORD_GUILD_ID) {
      log.info(`Registering commands to guild: ${config.DISCORD_GUILD_ID}`);
      await rest.put(Routes.applicationGuildCommands(config.DISCORD_BOT_ID, config.DISCORD_GUILD_ID), {
        body: commandsData,
      });
    } else {
      log.info('Registering commands globally');
      await rest.put(Routes.applicationCommands(config.DISCORD_BOT_ID), {
        body: commandsData,
      });
    }

    log.info(`Successfully registered ${commandsData.length} slash commands`);
  } catch (error) {
    log.error('Failed to register slash commands:', { error: String(error) });
    throw error;
  }
}

/**
 * Handle incoming slash command interactions
 */
export async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName } = interaction;

  log.info(`Handling slash command: ${commandName} from user ${interaction.user.tag}`);

  try {
    switch (commandName) {
      case 'status':
        await handleStatus(interaction);
        break;
      case 'workspace':
        await handleWorkspace(interaction);
        break;
      case 'flow':
        await handleFlow(interaction);
        break;
      case 'logs':
        await handleLogs(interaction);
        break;
      case 'confidence':
        await handleConfidence(interaction);
        break;
      case 'escalation':
        await handleEscalation(interaction);
        break;
      default:
        await interaction.reply({
          content: 'Unknown command',
          ephemeral: true,
        });
    }
  } catch (error) {
    log.error(`Error handling command ${commandName}:`, { error: String(error) });

    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Error: ${errorMessage}`,
        ephemeral: true,
      });
    }
  }
}

/**
 * /status command handler
 */
async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const threadId = interaction.channelId;
  const lock = getLock(threadId);
  const session = await getSession(threadId);
  const redisLockOwner = await checkLock(threadId);
  const redisAbort = await checkAbortFlag(threadId);
  const redisState = await getThreadState(threadId);
  const cachedSession = await getCachedSession(threadId);

  const embed = new EmbedBuilder()
    .setTitle('📊 Execution Status')
    .setColor(lock ? 0xffa500 : 0x00ff00)
    .setTimestamp();

  // Lock Status
  if (lock) {
    embed.addFields({
      name: '🔒 Lock Status',
      value: `**Locked** (Turn ${lock.currentTurn})`,
      inline: true,
    });
    embed.addFields({
      name: '🛑 Abort Flag',
      value: lock.abort || redisAbort ? '**SET**' : 'Not set',
      inline: true,
    });
  } else {
    embed.addFields({
      name: '🔒 Lock Status',
      value: 'Unlocked',
      inline: true,
    });
  }

  if (redisLockOwner) {
    embed.addFields({
      name: '🧠 Redis Lock',
      value: `Owner: ${redisLockOwner}`,
      inline: true,
    });
  }

  if (redisState) {
    embed.addFields({
      name: '⚡ Redis State',
      value: `State: ${redisState.state}\nTurn: ${redisState.turn}\nConfidence: ${redisState.confidence}%`,
      inline: false,
    });
  }

  if (cachedSession) {
    embed.addFields({
      name: '💾 Redis Session Cache',
      value: `Turn: ${cachedSession.currentTurn}\nModel: ${cachedSession.model}\nUpdated: ${cachedSession.updatedAt}`,
      inline: false,
    });
  }

  // Session Info
  if (session) {
    embed.addFields({
      name: '🤖 Active Agent',
      value: session.agent_role || 'None',
      inline: true,
    });
    embed.addFields({
      name: '🎯 Confidence Score',
      value: `${session.confidence_score ?? 80}%`,
      inline: true,
    });
    embed.addFields({
      name: '📁 Workspace',
      value: session.workspace_path || `/workspace/${threadId}`,
      inline: false,
    });

    // Last escalation
    const escalations = getEscalationHistory(session as Session | null);
    if (escalations.length > 0) {
      const last = escalations[0];
      embed.addFields({
        name: '⬆️ Last Escalation',
        value: `${last.fromModel} → ${last.toModel}\nReason: ${last.reason}`,
        inline: false,
      });
    }

    // Checkpoint info
    if (session.current_plan) {
      embed.addFields({
        name: '💾 Checkpoint',
        value: 'Active plan available',
        inline: true,
      });
    }
  } else {
    embed.addFields({
      name: 'ℹ️ Session',
      value: 'No active session',
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * /workspace command handler
 */
async function handleWorkspace(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();
  const threadId = interaction.channelId;

  switch (subcommand) {
    case 'list':
      await handleWorkspaceList(interaction, threadId);
      break;
    case 'sync':
      await handleWorkspaceSync(interaction, threadId);
      break;
    case 'clean':
      await handleWorkspaceClean(interaction, threadId);
      break;
    case 'upload':
      await handleWorkspaceUpload(interaction, threadId);
      break;
    default:
      await interaction.reply({
        content: 'Unknown workspace subcommand',
        ephemeral: true,
      });
  }
}

/**
 * /workspace list handler
 */
async function handleWorkspaceList(
  interaction: ChatInputCommandInteraction,
  defaultThreadId: string
): Promise<void> {
  await interaction.deferReply();

  const threadName = interaction.options.getString('thread_name');
  const threadId = threadName || defaultThreadId;

  try {
    const files = await listS3Files(threadId);

    if (files.length === 0) {
      await interaction.editReply({
        content: '📂 **Workspace is empty**\nNo files found in S3.',
      });
      return;
    }

    const tree = formatFileTree(files);
    const prefix = threadName ? `Thread: ${threadName}\n\n` : '';

    // Discord has a 2000 character limit
    const content = `${prefix}📁 **Workspace Files** (${files.length} files)\n\n\`\`\`\n${tree}\n\`\`\``;

    if (content.length > 1900) {
      // Truncate if too long
      const truncated = content.substring(0, 1900) + '\n... (truncated)';
      await interaction.editReply({ content: truncated });
    } else {
      await interaction.editReply({ content });
    }
  } catch (error) {
    log.error('Failed to list workspace files:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /workspace sync handler
 */
async function handleWorkspaceSync(
  interaction: ChatInputCommandInteraction,
  threadId: string
): Promise<void> {
  await interaction.deferReply();

  // Check if there's an active lock
  if (hasActiveLock(threadId)) {
    await interaction.editReply({
      content: '⚠️ Cannot sync while execution is in progress. Please wait or abort first.',
    });
    return;
  }

  try {
    await s3Sync.syncToS3(threadId);
    await interaction.editReply({
      content: '✅ **Sync Complete**\nWorkspace synced to S3 successfully.',
    });
  } catch (error) {
    log.error('Failed to sync workspace:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /workspace clean handler
 */
async function handleWorkspaceClean(
  interaction: ChatInputCommandInteraction,
  threadId: string
): Promise<void> {
  // Check admin permissions
  const member = interaction.member;
  const isAdmin =
    interaction.guild?.ownerId === interaction.user.id ||
    (member?.permissions as any)?.has?.(PermissionFlagsBits.Administrator);

  if (!isAdmin) {
    await interaction.reply({
      content: '❌ **Permission Denied**\nThis command requires Administrator permissions.',
      ephemeral: true,
    });
    return;
  }

  // Check if there's an active lock
  if (hasActiveLock(threadId)) {
    await interaction.reply({
      content: '⚠️ Cannot clean while execution is in progress. Please abort first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Delete local workspace
    await workspaceManager.deleteWorkspace(threadId);

    // Delete S3 prefix
    const deletedCount = await deleteS3Prefix(threadId);

    await interaction.editReply({
      content: `🗑️ **Workspace Cleaned**\n- Local workspace deleted\n- ${deletedCount} files deleted from S3`,
    });
  } catch (error) {
    log.error('Failed to clean workspace:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Clean failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /workspace upload handler
 */
async function handleWorkspaceUpload(
  interaction: ChatInputCommandInteraction,
  threadId: string
): Promise<void> {
  await interaction.deferReply();

  const filePath = interaction.options.getString('file_path', true);

  try {
    const buffer = await getS3File(threadId, filePath);
    const fileName = filePath.split('/').pop() || filePath;

    const attachment = new AttachmentBuilder(buffer, { name: fileName });

    await interaction.editReply({
      content: `📎 **File Upload**\nPath: \`${filePath}\` (${buffer.length} bytes)`,
      files: [attachment],
    });
  } catch (error) {
    const errorMsg = String(error);
    if (errorMsg.includes('NoSuchKey') || errorMsg.includes('404')) {
      await interaction.editReply({
        content: `❌ **File Not Found**\n\`${filePath}\` does not exist in this workspace.`,
      });
    } else {
      log.error('Failed to upload file:', { error: errorMsg });
      await interaction.editReply({
        content: `❌ Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  }
}

/**
 * /flow command handler
 */
async function handleFlow(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const flowType = interaction.options.getString('type', true) as FlowType;
  const threadId = interaction.channelId;

  // Validate flow type
  const validFlows: FlowType[] = [
    FlowType.SEQUENTIAL_THINKING,
    FlowType.BRANCH,
    FlowType.SIMPLE,
    FlowType.BREAKGLASS,
  ];

  if (!validFlows.includes(flowType)) {
    await interaction.editReply({
      content: `❌ Invalid flow type: ${flowType}`,
    });
    return;
  }

  try {
    const session = await getSession(threadId);

    if (!session) {
      await interaction.editReply({
        content: '❌ No active session in this thread. Start a conversation first.',
      });
      return;
    }

    // Update session with flow override
    await updateSession(threadId, {
      flow_override: flowType,
    });

    const flowEmojis: Record<string, string> = {
      sequential: '⏱️',
      branch: '🌿',
      simple: '💬',
      breakglass: '🚨',
    };

    await interaction.editReply({
      content: `${flowEmojis[flowType]} **Flow Override Set**\nNext execution will use: **${flowType}** flow\n\nThis will persist until the next execution completes.`,
    });
  } catch (error) {
    log.error('Failed to set flow:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Failed to set flow: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /logs command handler
 */
async function handleLogs(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const count = interaction.options.getInteger('count') || 5;
  const threadId = interaction.channelId;

  try {
    const summaries = await getExecutionSummaries(threadId, count);

    if (summaries.length === 0) {
      await interaction.editReply({
        content: '📭 **No Execution Logs**\nNo executions found for this thread yet.',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`📜 Recent Executions (Last ${summaries.length})`)
      .setColor(0x3498db)
      .setTimestamp();

    for (const summary of summaries) {
      const emoji = getOutcomeEmoji(summary.outcome);
      const confidence = summary.confidenceScore !== null ? `${summary.confidenceScore}%` : 'N/A';

      embed.addFields({
        name: `${emoji} ${summary.taskSummary} - ${formatTimestamp(summary.timestamp)}`,
        value: `Model: \`${summary.finalModel}\` | Turns: ${summary.turnCount} | Confidence: ${confidence}`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    log.error('Failed to get logs:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Failed to retrieve logs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /confidence command handler
 */
async function handleConfidence(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const threadId = interaction.channelId;

  try {
    const session = await getSession(threadId);
    const history = await getConfidenceHistory(threadId, 10);

    if (!session && history.length === 0) {
      await interaction.editReply({
        content: '📭 **No Confidence Data**\nNo executions found for this thread yet.',
      });
      return;
    }

    const currentConfidence = session?.confidence_score ?? 80;

    // Calculate trend
    let trend = '➡️ Stable';
    let trendColor = 0x95a5a6;

    if (history.length >= 2) {
      const first = history[0].confidence;
      const last = history[history.length - 1].confidence;
      const diff = last - first;

      if (diff > 10) {
        trend = '📈 Improving';
        trendColor = 0x2ecc71;
      } else if (diff < -10) {
        trend = '📉 Declining';
        trendColor = 0xe74c3c;
      }
    }

    // Determine confidence level
    let level = '🟢 High';
    if (currentConfidence < 30) level = '🔴 Critical';
    else if (currentConfidence < 50) level = '🟠 Low';
    else if (currentConfidence < 70) level = '🟡 Moderate';

    const embed = new EmbedBuilder()
      .setTitle('📊 Confidence Report')
      .setColor(trendColor)
      .addFields(
        { name: 'Current Score', value: `${currentConfidence}%`, inline: true },
        { name: 'Level', value: level, inline: true },
        { name: 'Trend', value: trend, inline: true }
      );

    // Add history if available
    if (history.length > 0) {
      const historyStr = history
        .map((h) => `${formatTimestamp(h.timestamp)}: ${h.confidence}%`)
        .join('\n');
      embed.addFields({
        name: '📈 History (Last 10)',
        value: historyStr,
        inline: false,
      });
    }

    // Check for escalations triggered by low confidence
    const escalations = getEscalationHistory(session as Session | null);
    const confidenceEscalations = escalations.filter((e) =>
      e.reason.toLowerCase().includes('confidence')
    );

    if (confidenceEscalations.length > 0) {
      embed.addFields({
        name: '⚠️ Confidence-Triggered Escalations',
        value: `${confidenceEscalations.length} escalations due to low confidence`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    log.error('Failed to get confidence:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Failed to retrieve confidence data: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

/**
 * /escalation command handler
 */
async function handleEscalation(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const threadId = interaction.channelId;

  try {
    const session = await getSession(threadId);
    const escalations = getEscalationHistory(session as Session | null);

    if (escalations.length === 0) {
      await interaction.editReply({
        content: '📭 **No Escalations**\nNo escalations have occurred in this thread.',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`⬆️ Escalation History (${escalations.length} total)`)
      .setColor(0xe67e22)
      .setTimestamp();

    // Show last 10 escalations
    for (const escalation of escalations.slice(0, 10)) {
      embed.addFields({
        name: `${escalation.fromModel} → ${escalation.toModel} (Turn ${escalation.turnNumber})`,
        value: `Reason: ${escalation.reason}\nTime: ${formatTimestamp(escalation.timestamp)}`,
        inline: false,
      });
    }

    if (escalations.length > 10) {
      embed.setFooter({ text: `And ${escalations.length - 10} more escalations...` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    log.error('Failed to get escalations:', { error: String(error) });
    await interaction.editReply({
      content: `❌ Failed to retrieve escalation history: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}
