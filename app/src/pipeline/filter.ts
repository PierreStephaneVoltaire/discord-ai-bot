import { getConfig } from '../config/index';
import { createLogger } from '../utils/logger';
import type { DiscordMessagePayload } from '../modules/discord/types';
import type { FilterResult } from './types';

const log = createLogger('FILTER');

export function filterMessage(message: DiscordMessagePayload): FilterResult {
  log.info(`Checking message ${message.id}`);

  const config = getConfig();

  const authorUsername = message.author.username.toLowerCase();
  const isSelf = authorUsername === config.BOT_USERNAME.toLowerCase();
  log.info(`Author: ${message.author.username}, is_self: ${isSelf}`);

  if (isSelf) {
    log.info(`Filter result: passed=false, reason=self_message`);
    return {
      passed: false,
      reason: 'Message from self',
      context: {
        is_self: true,
        is_stale: false,
        is_mentioned: false,
        is_secondary_bot: false,
        force_respond: false,
        is_breakglass: false,
      },
    };
  }

  const messageTime = new Date(message.timestamp);
  const now = new Date();
  const diffMinutes = (now.getTime() - messageTime.getTime()) / (1000 * 60);
  const isStale = diffMinutes > config.STALENESS_MINUTES;
  log.info(`Message age: ${diffMinutes.toFixed(1)} minutes, is_stale: ${isStale}`);

  if (isStale) {
    log.info(`Filter result: passed=false, reason=stale_message`);
    return {
      passed: false,
      reason: `Message too old (${diffMinutes.toFixed(0)} minutes)`,
      context: {
        is_self: false,
        is_stale: true,
        is_mentioned: false,
        is_secondary_bot: false,
        force_respond: false,
        is_breakglass: false,
      },
    };
  }

  const isMentioned = checkMention(message, config.DISCORD_BOT_ID);
  log.info(`Mentions bot: ${isMentioned}`);

  const isSecondaryBot = authorUsername === config.OTHER_BOT_USERNAME.toLowerCase();
  log.info(`Is secondary bot (${config.OTHER_BOT_USERNAME}): ${isSecondaryBot}`);

  // Check for breakglass pattern: @{modelname} at start of message
  const breakglassMatch = message.content.match(/^@(opus|sonnet|gemini|qwen|gpt|default|glm)\b/i);
  const isBreakglass = breakglassMatch !== null;
  const breakglassModel = isBreakglass ? breakglassMatch[1].toLowerCase() : undefined;
  
  if (isBreakglass) {
    log.info(`Breakglass detected: model=${breakglassModel}`);
  }

  const forceRespond = isMentioned || isSecondaryBot || isBreakglass;

  log.info(`Filter result: passed=true`);

  return {
    passed: true,
    context: {
      is_self: false,
      is_stale: false,
      is_mentioned: isMentioned,
      is_secondary_bot: isSecondaryBot,
      force_respond: forceRespond,
      is_breakglass: isBreakglass,
      breakglass_model: breakglassModel,
    },
  };
}

function checkMention(message: DiscordMessagePayload, botId: string): boolean {
  const hasMention = message.mentions.some((m) => m.id === botId);
  if (hasMention) return true;

  const content = message.content.toLowerCase();
  if (content.includes(`<@${botId}>`) || content.includes(`<@!${botId}>`)) {
    return true;
  }

  const config = getConfig();
  if (content.includes(`@${config.BOT_USERNAME.toLowerCase()}`)) {
    return true;
  }

  return false;
}
