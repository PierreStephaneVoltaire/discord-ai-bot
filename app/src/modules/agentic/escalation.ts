import { ExecutionState, ExecutionTurn, EscalationEvent } from '../litellm/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('AGENTIC:ESCALATION');

/**
 * Model capability tiers (ordered from least to most capable)
 * 
 * Tier 1: Ultra-fast, NO TOOL SUPPORT (social, writing, simple Q&A)
 * Tier 2: Fast with FULL TOOL SUPPORT (coding, technical tasks)
 * Tier 3: Balanced with FULL TOOL SUPPORT (complex code, reviews)
 * Tier 4: Premium with FULL TOOL SUPPORT (critical decisions, most expensive)
 * 
 * To add a new model:
 * 1. Add it to the appropriate tier in MODEL_TIERS
 * 2. Ensure tier 2+ models support function calling/MCP tools
 * 3. The escalation system will automatically use it
 * 
 * Example: Adding GPT-4o-mini to tier2
 *   tier2: ['gemini-3-pro', 'gpt-4o-mini']  // Both must support tools
 */
export const MODEL_TIERS = {
  tier1: [
    "mistral-nemo",          // $0.02/$0.04
    "gpt-oss-120b:exacto",
    "general",               // $0.10/$0.40 basically gemini-2.5-flash-lite
    "gemini-2.5-flash-lite",        // $0.10/$0.40
  ],
  
  tier2: [
    "minimax-m2.1",          // $0.30/$1.20
    "gpt-5.1-codex-mini",     // $0.25/$2
    "gemini-3-flash",        // $0.50/$3
    "glm-4.7",                   // $0.54/$1.98
  ],
  
  tier3: [
    "qwen3-coder-plus",      // $1/$5
    "gpt-5.1-codex-max" ,      // $1.25/$10
    "gemini-3-pro",          // $2/$12
    "kimi-k2.5",                // $0.50/$2.80
  ],
  
  tier4: [
    "qwen3-max",                    // $1.20/$6
    "gpt-5.2-codex",                 // $1.75/$14
    "claude-sonnet-4.5",                // $3/$15
    
    "claude-opus-4.5",                  // $5/$25
  ],
} as const;
// Flatten tiers into capability order
export const MODEL_CAPABILITY_ORDER = [
  ...MODEL_TIERS.tier1,
  ...MODEL_TIERS.tier2,
  ...MODEL_TIERS.tier3,
  ...MODEL_TIERS.tier4,
] as const;

export type ModelCapability = typeof MODEL_CAPABILITY_ORDER[number];

/**
 * Dynamically builds escalation ladder from MODEL_CAPABILITY_ORDER
 * Each model escalates to the next one in the list
 */
function buildEscalationLadder(): Record<string, string> {
  const ladder: Record<string, string> = {};
  
  for (let i = 0; i < MODEL_CAPABILITY_ORDER.length; i++) {
    const current = MODEL_CAPABILITY_ORDER[i];
    const next = MODEL_CAPABILITY_ORDER[i + 1] || current; // Stay at max if at end
    ladder[current] = next;
  }
  
  return ladder;
}

export const ESCALATION_LADDER = buildEscalationLadder();

/**
 * Checks if escalation should occur based on current state
 */
export function checkEscalationTriggers(
  state: ExecutionState,
  turn: ExecutionTurn,
  currentModel: string,
  consecutiveLowConfidenceTurns: number
): {
  shouldEscalate: boolean;
  reason: string;
  suggestedModel?: string;
} {
  const triggers: Array<{ condition: boolean; reason: string }> = [];

  // Trigger 1: Low confidence for multiple consecutive turns
  if (consecutiveLowConfidenceTurns >= 2) {
    triggers.push({
      condition: true,
      reason: `Confidence below 30% for ${consecutiveLowConfidenceTurns} consecutive turns`,
    });
  }

  // Trigger 2: Same error repeating
  if (state.sameErrorCount >= 3) {
    triggers.push({
      condition: true,
      reason: `Same error repeated ${state.sameErrorCount} times`,
    });
  }

  // Trigger 3: No progress for multiple turns
  if (state.noProgressTurns >= 5) {
    triggers.push({
      condition: true,
      reason: `No file changes for ${state.noProgressTurns} turns`,
    });
  }

  // Trigger 4: Model reports being stuck
  if (turn.status === 'stuck') {
    triggers.push({
      condition: true,
      reason: 'Model reported being stuck',
    });
  }

  // Trigger 5: User corrections indicate wrong approach
  if (state.userCorrectionCount >= 2) {
    triggers.push({
      condition: true,
      reason: `User marked approach as wrong ${state.userCorrectionCount} times`,
    });
  }

  // Check if any triggers fired
  if (triggers.length === 0) {
    return { shouldEscalate: false, reason: 'No escalation triggers met' };
  }

  // Check if we can escalate
  const nextModel = ESCALATION_LADDER[currentModel];
  if (nextModel === currentModel) {
    // Already at max capability
    return {
      shouldEscalate: false,
      reason: `Already at maximum model capability (${currentModel})`,
    };
  }

  // Combine all trigger reasons
  const combinedReason = triggers.map((t) => t.reason).join('; ');

  log.warn(`Escalation triggered: ${combinedReason}`);

  return {
    shouldEscalate: true,
    reason: combinedReason,
    suggestedModel: nextModel,
  };
}

/**
 * Checks if the current model is at maximum escalation level
 */
export function isAtMaxEscalation(currentModel: string): boolean {
  return ESCALATION_LADDER[currentModel] === currentModel;
}

/**
 * Resets escalation-related state after an escalation occurs
 */
export function resetEscalationState(state: ExecutionState): void {
  state.sameErrorCount = 0;
  state.noProgressTurns = 0;
  state.userCorrectionCount = 0;
  log.info('Escalation state reset');
}

/**
 * Gets the next model in the escalation ladder
 */
export function getNextModel(currentModel: string): string | null {
  const next = ESCALATION_LADDER[currentModel];
  return next === currentModel ? null : next;
}

/**
 * Gets the model capability index (higher = more capable)
 */
export function getModelCapabilityIndex(model: string): number {
  const index = MODEL_CAPABILITY_ORDER.indexOf(model as ModelCapability);
  return index === -1 ? 0 : index;
}

/**
 * Gets the tier a model belongs to
 */
export function getModelTier(model: string): keyof typeof MODEL_TIERS | null {
  for (const [tier, models] of Object.entries(MODEL_TIERS)) {
    if ((models as readonly string[]).includes(model)) {
      return tier as keyof typeof MODEL_TIERS;
    }
  }
  return null;
}

/**
 * Checks if a model can escalate to another model
 */
export function canEscalateTo(fromModel: string, toModel: string): boolean {
  const fromIndex = getModelCapabilityIndex(fromModel);
  const toIndex = getModelCapabilityIndex(toModel);
  return toIndex > fromIndex;
}
