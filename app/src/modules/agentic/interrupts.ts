import { InterruptCommand, ExecutionState, Message } from '../litellm/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:INTERRUPTS');

// Emoji to interrupt type mapping
const EMOJI_TO_INTERRUPT: Record<string, InterruptCommand['type']> = {
  '🛑': 'STOP',
  '💬': 'CLARIFY',
  '🔄': 'RETRY',
  '✅': 'CONTINUE',
  '❌': 'WRONG',
  '🚀': 'ESCALATE',
};

// Command keywords to interrupt type mapping
const COMMAND_KEYWORDS: Record<string, InterruptCommand['type']> = {
  'STOP': 'STOP',
  'WAIT': 'STOP',
  'CLARIFY': 'CLARIFY',
  'RETRY': 'RETRY',
  'CONTINUE': 'CONTINUE',
  'WRONG': 'WRONG',
  'ESCALATE': 'ESCALATE',
};

/**
 * Checks Discord for emoji reactions and command messages
 * 
 * TODO Phase 2: Implement Discord API integration
 * - Use getDiscordClient() to fetch messages from threadId
 * - Check reactions on bot's recent messages (last 5-10)
 * - Parse command messages using parseInterruptCommand()
 * - Return most recent interrupt, prioritizing STOP > CLARIFY > others
 */
export async function checkForInterrupts(threadId: string): Promise<InterruptCommand | null> {
  // TODO: Implement Discord API calls to check for:
  // 1. Emoji reactions on recent progress messages
  // 2. Command messages in the thread
  
  log.debug(`Checking for interrupts in thread ${threadId}`);
  
  // Placeholder implementation
  // In production, this would:
  // - Fetch recent messages from Discord thread
  // - Check for emoji reactions on bot's progress messages
  // - Parse command messages (e.g., "STOP", "CLARIFY: need more context")
  // - Return the most recent interrupt command
  
  return null;
}

/**
 * Parses a Discord message for interrupt commands
 */
export function parseInterruptCommand(messageContent: string): InterruptCommand | null {
  const upperContent = messageContent.trim().toUpperCase();
  
  // Check for command keywords
  for (const [keyword, type] of Object.entries(COMMAND_KEYWORDS)) {
    if (upperContent.startsWith(keyword)) {
      const message = messageContent.substring(keyword.length).trim();
      return {
        type,
        message: message || undefined,
        timestamp: new Date().toISOString(),
      };
    }
  }
  
  return null;
}

/**
 * Handles an interrupt command and updates state accordingly
 */
export async function handleInterrupt(
  interrupt: InterruptCommand,
  state: ExecutionState,
  conversationHistory: Message[]
): Promise<{ action: 'stop' | 'clarify' | 'continue' | 'retry'; message: string }> {
  log.info(`Handling interrupt: ${interrupt.type}`);

  switch (interrupt.type) {
    case 'STOP':
      return {
        action: 'stop',
        message: 'Execution stopped by user request. Progress has been saved.',
      };

    case 'CLARIFY':
      if (interrupt.message) {
        // User provided clarification, add to conversation
        return {
          action: 'clarify',
          message: interrupt.message,
        };
      } else {
        // User wants to provide clarification, pause and wait
        return {
          action: 'stop',
          message: 'Paused for user clarification. Please provide additional context.',
        };
      }

    case 'RETRY':
      // Remove last assistant message and retry
      const lastAssistantIndex = conversationHistory.length - 1;
      if (lastAssistantIndex >= 0 && conversationHistory[lastAssistantIndex].role === 'assistant') {
        conversationHistory.pop();
        log.info('Removed last assistant message, will retry with different approach');
      }
      
      // Reset some state to give fresh attempt
      state.sameErrorCount = Math.max(0, state.sameErrorCount - 1);
      state.noProgressTurns = Math.max(0, state.noProgressTurns - 1);
      
      return {
        action: 'retry',
        message: 'Retrying last turn with a different approach.',
      };

    case 'CONTINUE':
      // Override low confidence warnings, user wants to proceed
      log.info('User overriding low confidence, continuing execution');
      return {
        action: 'continue',
        message: 'Continuing execution as requested (confidence override).',
      };

    case 'WRONG':
      // Mark current approach as wrong, increment correction count
      state.userCorrectionCount++;
      log.warn(`User marked approach as wrong (correction count: ${state.userCorrectionCount})`);
      
      // Add correction to conversation
      const correctionMessage = interrupt.message 
        ? `The current approach is incorrect. ${interrupt.message}`
        : 'The current approach is incorrect. Please try a different strategy.';
      
      return {
        action: 'clarify',
        message: correctionMessage,
      };

    case 'ESCALATE':
      // Force model escalation (will be handled in main loop)
      log.info('User requested immediate model escalation');
      return {
        action: 'continue',
        message: 'Escalating to more capable model as requested.',
      };

    default:
      log.warn(`Unknown interrupt type: ${interrupt.type}`);
      return {
        action: 'continue',
        message: 'Unknown interrupt type, continuing execution.',
      };
  }
}

/**
 * Records an interrupt in the execution state
 */
export function recordInterrupt(state: ExecutionState, interrupt: InterruptCommand): void {
  state.userInterrupts.push({
    type: interrupt.type,
    message: interrupt.message,
  });
  log.debug(`Recorded interrupt: ${interrupt.type}`);
}
