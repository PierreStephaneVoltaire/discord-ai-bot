import { createLogger } from '../utils/logger';

const log = createLogger('HANDLERS:DEBOUNCE');

const DEFAULT_DEBOUNCE_MS = 10000; // 10 seconds

interface DebounceTimer {
  timer: NodeJS.Timeout;
  messages: string[];
  lastReset: Date;
}

// Map of channel/thread ID to debounce timer
const debounceTimers = new Map<string, DebounceTimer>();

/**
 * Adds a message to debounce queue and resets the timer
 * Returns a promise that resolves when the debounce timer expires
 */
export function debounceMessage(
  channelId: string,
  messageId: string,
  debounceMs: number = DEFAULT_DEBOUNCE_MS
): Promise<string[]> {
  return new Promise((resolve) => {
    // Clear existing timer if any
    const existing = debounceTimers.get(channelId);
    if (existing) {
      clearTimeout(existing.timer);
      log.debug(`Resetting debounce timer for channel ${channelId}`);
    }

    // Create new timer
    const timer = setTimeout(() => {
      const timerData = debounceTimers.get(channelId);
      if (timerData) {
        const messages = [...timerData.messages];
        debounceTimers.delete(channelId);
        log.info(`Debounce timer expired for channel ${channelId}, processing ${messages.length} messages`);
        resolve(messages);
      }
    }, debounceMs);

    // Store timer data
    debounceTimers.set(channelId, {
      timer,
      messages: existing ? [...existing.messages, messageId] : [messageId],
      lastReset: new Date(),
    });

    log.debug(`Added message ${messageId} to debounce queue for channel ${channelId}`);
  });
}

/**
 * Cancels a pending debounce timer for a channel
 */
export function cancelDebounce(channelId: string): void {
  const existing = debounceTimers.get(channelId);
  if (existing) {
    clearTimeout(existing.timer);
    debounceTimers.delete(channelId);
    log.debug(`Cancelled debounce timer for channel ${channelId}`);
  }
}

/**
 * Gets the current debounce state for a channel
 */
export function getDebounceState(channelId: string): {
  active: boolean;
  messageCount: number;
  lastReset: Date | null;
} {
  const existing = debounceTimers.get(channelId);
  if (!existing) {
    return { active: false, messageCount: 0, lastReset: null };
  }

  return {
    active: true,
    messageCount: existing.messages.length,
    lastReset: existing.lastReset,
  };
}

/**
 * Clears all debounce timers (useful for shutdown)
 */
export function clearAllDebounceTimers(): void {
  for (const [channelId, data] of debounceTimers.entries()) {
    clearTimeout(data.timer);
    log.debug(`Cleared debounce timer for channel ${channelId}`);
  }
  debounceTimers.clear();
}
