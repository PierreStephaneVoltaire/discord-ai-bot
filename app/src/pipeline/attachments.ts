import { request } from 'undici';
import { createLogger } from '../utils/logger';
import type { DiscordAttachment } from '../modules/discord/types';
import type { ProcessedAttachment, AttachmentCategory } from './types';

const log = createLogger('ATTACHMENTS');

export async function processAttachments(
  attachments: AttachmentCategory,
  isSecondaryBot: boolean
): Promise<ProcessedAttachment[]> {
  if (isSecondaryBot) {
    log.info('Skipping attachments (is_secondary_bot: true)');
    return [];
  }

  const allAttachments = [
    ...attachments.images,
    ...attachments.textFiles,
    ...attachments.otherFiles,
  ];

  log.info(`Processing ${allAttachments.length} attachments`);

  if (allAttachments.length === 0) {
    return [];
  }

  const results: ProcessedAttachment[] = [];

  for (const att of allAttachments) {
    log.info(`Attachment: ${att.filename}, type: ${att.content_type || 'unknown'}`);
    log.info(`Downloading: ${att.url}`);

    try {
      const response = await request(att.url, {
        method: 'GET',
      });

      if (response.statusCode !== 200) {
        throw new Error(`HTTP ${response.statusCode}`);
      }

      const buffer = Buffer.from(await response.body.arrayBuffer());
      const base64 = buffer.toString('base64');

      log.info(`Download complete: ${att.filename}, size: ${buffer.length} bytes`);

      results.push({
        filename: att.filename,
        url: att.url,
        content_type: att.content_type,
        base64,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`Download failed: ${att.filename}`, { error: errorMessage });

      results.push({
        filename: att.filename,
        url: att.url,
        content_type: att.content_type,
        error: errorMessage,
      });
    }
  }

  log.info(`Processed ${results.length} attachments, ${results.filter((r) => r.base64).length} successful`);
  return results;
}
