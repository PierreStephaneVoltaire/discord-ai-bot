import { getDiscordClient, sendMessage, sendMessageChunks } from '../modules/discord/index';
import { createLogger } from '../utils/logger';
import { parseResponse } from '../modules/workspace/response-parser';
import { workspaceManager } from '../modules/workspace/manager';

const log = createLogger('RESPONSE');

const MAX_DISCORD_LENGTH = 1900;

export interface ResponseInput {
  response: string;
  channelId: string;
  threadId: string; // NEW: Required for workspace access
}

export async function formatAndSendResponse(input: ResponseInput): Promise<void> {
  log.info(`Formatting response for Discord (Thread: ${input.threadId})`);
  log.info(`Raw response length: ${input.response.length}`);

  const parts = parseResponse(input.response);
  log.info(`Parsed response into ${parts.length} parts`);

  const client = getDiscordClient();

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    log.info(`Processing part ${i + 1}/${parts.length} (Type: ${part.type})`);

    if (part.type === 'text') {
      if (part.content.length > MAX_DISCORD_LENGTH) {
        await sendMessageChunks(client, input.channelId, part.content, MAX_DISCORD_LENGTH);
      } else if (part.content.trim()) {
        await sendMessage(client, input.channelId, { content: part.content });
      }
    } else if (part.type === 'file' && part.filePath) {
      try {
        log.info(`Fetching file from workspace: ${part.filePath}`);
        const content = await workspaceManager.readFile(input.threadId, part.filePath);

        await sendMessage(client, input.channelId, {
          content: `📎 **${part.content}**`,
          files: [
            {
              name: part.content,
              data: content,
            },
          ],
        });
      } catch (err) {
        log.error(`Failed to attach file ${part.filePath}`, { error: String(err) });
        await sendMessage(client, input.channelId, {
          content: `⚠️ *Could not attach file \`${part.content}\`. It may not have been created or saved properly.*`
        });
      }
    }

    if (i < parts.length - 1) {
      await sleep(1500); // Respect rate limits
    }
  }

  log.info('All response parts processed');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
