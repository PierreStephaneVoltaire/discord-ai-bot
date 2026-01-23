import { getConfig } from '../config/index';
import { getDiscordClient, getMessages } from '../modules/discord/index';
import { createLogger } from '../utils/logger';
import type { DiscordMessagePayload, DiscordAttachment } from '../modules/discord/types';
import type { FormattedHistory, AttachmentCategory, ThreadContext } from './types';

const log = createLogger('HISTORY');

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const TEXT_EXTENSIONS = [
  'js', 'ts', 'py', 'tf', 'txt', 'csv', 'json', 'yaml', 'yml', 'md', 'sh',
  'sql', 'html', 'css', 'xml', 'toml', 'ini', 'go', 'rs', 'java', 'hcl',
];

export async function formatHistory(
  currentMessage: DiscordMessagePayload,
  thread: ThreadContext
): Promise<FormattedHistory> {
  log.info(`Formatting history for channel ${thread.channel_id}`);

  const config = getConfig();
  const client = getDiscordClient();

  const channelId = thread.thread_id || thread.channel_id;
  const messages = await getMessages(client, channelId, 50);
  log.info(`Fetched ${messages.length} messages`);

  const cutoffTime = new Date();
  cutoffTime.setMinutes(cutoffTime.getMinutes() - config.STALENESS_MINUTES);

  const recentMessages = messages.filter((m) => {
    const msgTime = new Date(m.timestamp);
    return msgTime > cutoffTime;
  });
  log.info(`Filtered to last ${config.STALENESS_MINUTES} minutes: ${recentMessages.length} messages`);

  const historyMessages = recentMessages
    .filter((m) => m.id !== currentMessage.id)
    .reverse();

  const formattedLines = historyMessages.map((msg) => {
    const author = getAuthorName(msg.author);
    const content = formatContent(msg.content, msg.mentions);
    const attachmentSummary = getAttachmentSummary(msg.attachments);

    return `${author}: ${content}${attachmentSummary}`;
  });

  const formattedHistory = formattedLines.join('\n');
  log.info(`Formatted history length: ${formattedHistory.length} chars`);

  const currentAuthor = getAuthorName(currentMessage.author);
  log.info(`Current message from: ${currentAuthor}`);

  const currentContent = formatContent(currentMessage.content, currentMessage.mentions);
  const currentAttachments = categorizeAttachments(currentMessage.attachments);
  log.info(`Current message attachments: ${currentMessage.attachments.length}`);

  return {
    formatted_history: formattedHistory,
    current_message: currentContent,
    current_author: currentAuthor,
    current_attachments: currentAttachments,
  };
}

function getAuthorName(author: { username: string; global_name?: string }): string {
  return author.global_name || author.username || 'Unknown';
}

function formatContent(
  content: string,
  mentions: Array<{ id: string; username: string }>
): string {
  let formatted = content;

  for (const mention of mentions) {
    const name = mention.username || 'User';
    formatted = formatted.replace(
      new RegExp(`<@!?${mention.id}>`, 'g'),
      `@${name}`
    );
  }

  return formatted;
}

function getAttachmentSummary(
  attachments: Array<{ filename: string; content_type?: string }>
): string {
  if (!attachments || attachments.length === 0) return '';

  const cats = categorizeAttachments(attachments as DiscordAttachment[]);
  const parts: string[] = [];

  if (cats.images.length > 0) {
    parts.push(`[${cats.images.length} image(s)]`);
  }
  if (cats.textFiles.length > 0) {
    const names = cats.textFiles.map((f) => f.filename).join(', ');
    parts.push(`[${cats.textFiles.length} code file(s): ${names}]`);
  }
  if (cats.otherFiles.length > 0) {
    parts.push(`[${cats.otherFiles.length} other file(s)]`);
  }

  return parts.length > 0 ? '\n' + parts.join('\n') : '';
}

function categorizeAttachments(attachments: DiscordAttachment[]): AttachmentCategory {
  const result: AttachmentCategory = {
    images: [],
    textFiles: [],
    otherFiles: [],
  };

  for (const att of attachments) {
    const ext = getExtension(att.filename);
    const contentType = att.content_type || '';

    if (contentType.startsWith('image/') || IMAGE_EXTENSIONS.includes(ext)) {
      result.images.push(att);
    } else if (contentType.startsWith('text/') || TEXT_EXTENSIONS.includes(ext)) {
      result.textFiles.push(att);
    } else {
      result.otherFiles.push(att);
    }
  }

  return result;
}

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}
