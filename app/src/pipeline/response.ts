import { getDiscordClient, sendMessage, sendMessageChunks } from '../modules/discord/index';
import { createLogger } from '../utils/logger';

const log = createLogger('RESPONSE');

const MAX_DISCORD_LENGTH = 1900;

export interface ResponseInput {
  response: string;
  channelId: string;
  branchName?: string;
}

interface FileBlock {
  filename: string;
  content: string;
}

interface ParsedResponse {
  textBlocks: string[];
  fileBlocks: FileBlock[];
}

export async function formatAndSendResponse(input: ResponseInput): Promise<void> {
  log.info(`Formatting response for Discord`);
  log.info(`Raw response length: ${input.response.length}`);

  let content = input.response;

  if (input.branchName) {
    const repoLink = `\n\n📁 **Repo:** https://ca-central-1.console.aws.amazon.com/codesuite/codecommit/repositories/discord-ai-sandbox/browse/refs/heads/${input.branchName}`;
    log.info(`Adding repo link for branch: ${input.branchName}`);
    content += repoLink;
  }

  const parsed = parseResponse(content);
  log.info(`Splitting into chunks: ${parsed.textBlocks.length}`);
  log.info(`Extracting file blocks: ${parsed.fileBlocks.length}`);

  const client = getDiscordClient();
  let chunkIndex = 0;
  const totalChunks = parsed.textBlocks.length + parsed.fileBlocks.length;

  for (const textBlock of parsed.textBlocks) {
    chunkIndex++;
    log.info(`Sending chunk ${chunkIndex}/${totalChunks} to channel ${input.channelId}`);

    if (textBlock.length > MAX_DISCORD_LENGTH) {
      await sendMessageChunks(client, input.channelId, textBlock, MAX_DISCORD_LENGTH);
    } else {
      await sendMessage(client, input.channelId, { content: textBlock });
    }

    log.info(`Chunk sent successfully`);

    if (chunkIndex < totalChunks) {
      await sleep(1500);
    }
  }

  for (const fileBlock of parsed.fileBlocks) {
    chunkIndex++;
    log.info(`Sending file: ${fileBlock.filename}`);

    await sendMessage(client, input.channelId, {
      content: `📎 **${fileBlock.filename}**`,
      files: [
        {
          name: fileBlock.filename,
          data: Buffer.from(fileBlock.content, 'utf-8'),
        },
      ],
    });

    log.info(`File sent successfully`);

    if (chunkIndex < totalChunks) {
      await sleep(1500);
    }
  }

  log.info('All responses sent');
}

function parseResponse(content: string): ParsedResponse {
  const fileBlocks: FileBlock[] = [];
  const fileRegex = /<file\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/file>/g;

  let lastIndex = 0;
  const textParts: string[] = [];
  let match;

  while ((match = fileRegex.exec(content)) !== null) {
    const textBefore = content.substring(lastIndex, match.index).trim();
    if (textBefore) {
      textParts.push(textBefore);
    }

    fileBlocks.push({
      filename: match[1],
      content: match[2].trim(),
    });

    lastIndex = fileRegex.lastIndex;
  }

  const textAfter = content.substring(lastIndex).trim();
  if (textAfter) {
    textParts.push(textAfter);
  }

  const textBlocks = textParts.flatMap((text) => splitText(text, MAX_DISCORD_LENGTH));

  return { textBlocks, fileBlocks };
}

function splitText(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitPoint = maxLength;
    const lastNewline = remaining.lastIndexOf('\n', maxLength);
    if (lastNewline > maxLength * 0.7) {
      splitPoint = lastNewline + 1;
    }

    chunks.push(remaining.substring(0, splitPoint));
    remaining = remaining.substring(splitPoint);
  }

  return chunks.filter((c) => c.length > 0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
