import { TaskType, AgentRole, TaskComplexity } from '../modules/litellm/types';
import { MODEL_TIERS } from '../modules/agentic/escalation';

/**
 * Map agent roles to model tiers
 * 
 * IMPORTANT: 
 * - Tier 1 models may NOT support tools (use for social/writing only)
 * - Tier 2-4 models MUST support MCP tools (file ops, commands, etc.)
 * 
 * This allows you to:
 * 1. Add new models to a tier in escalation.ts
 * 2. Automatically get round-robin or random selection within tier
 * 
 * Example: If tier2 = ['gemini-3-pro', 'gpt-4o-mini'], both can be used for PYTHON_CODER
 */
export const AGENT_MODEL_TIER_MAP: Record<AgentRole, keyof typeof MODEL_TIERS> = {
  [AgentRole.COMMAND_EXECUTOR]: 'tier2',  // Needs tools - use tier2+
  [AgentRole.PYTHON_CODER]: 'tier2',      // Needs tools
  [AgentRole.JS_TS_CODER]: 'tier2',       // Needs tools
  [AgentRole.DEVOPS_ENGINEER]: 'tier3',   // Needs tools
  [AgentRole.ARCHITECT]: 'tier4',         // Needs tools
  [AgentRole.CODE_REVIEWER]: 'tier3',     // Needs tools
  [AgentRole.DOCUMENTATION_WRITER]: 'tier3', // Needs tools
  [AgentRole.DBA]: 'tier3',               // Needs tools
  [AgentRole.RESEARCHER]: 'tier2',        // Needs tools
};

/**
 * Map agent roles to specific model index within their tier
 * 
 * This allows fine-grained control over which model in a tier to use.
 * 
 * Example: If tier2 = ['gemini-3-pro', 'gpt-4o-mini', 'claude-haiku']
 *   - index 0 → gemini
 *   - index 1 → gpt-4o-mini
 *   - index 2 → claude-haiku
 *   - index 3 → claude-haiku (out of bounds, uses last)
 *   - index -1 → claude-haiku (negative, uses last)
 * 
 * If not specified, defaults to index 0 (first model in tier)
 * 
 * Common patterns:
 * - Load balancing: Assign different agents to different indices
 * - Cost optimization: Use index 0 for cheaper models, higher indices for premium
 * - Provider diversity: Spread agents across different providers in same tier
 */
export const AGENT_MODEL_INDEX_MAP: Partial<Record<AgentRole, number>> = {
  [AgentRole.PYTHON_CODER]: 1,     
  [AgentRole.JS_TS_CODER]: 0,      
  [AgentRole.RESEARCHER]: 1,       
  [AgentRole.DEVOPS_ENGINEER]: 3, 
  [AgentRole.COMMAND_EXECUTOR]: 2,  
  [AgentRole.ARCHITECT]: 3,         
  [AgentRole.CODE_REVIEWER]: 3,     
  [AgentRole.DOCUMENTATION_WRITER]: 0, 
  [AgentRole.DBA]: 2,              
};

/**
 * Gets a model from a tier at a specific index
 * Handles out-of-bounds gracefully:
 * - If index >= length: use last model in tier
 * - If index < 0: use last model in tier
 * - If index valid: use that model
 */
function getModelFromTier(tier: keyof typeof MODEL_TIERS, index: number = 0): string {
  const models = MODEL_TIERS[tier] as readonly string[];
  
  // Handle out of bounds
  if (index < 0 || index >= models.length) {
    // Use last model in tier
    return models[models.length - 1];
  }
  
  return models[index];
}

// Backward compatibility: Map agent roles to default models
// This now respects the index map
export const AGENT_MODEL_MAP: Record<AgentRole, string> = Object.fromEntries(
  Object.entries(AGENT_MODEL_TIER_MAP).map(([role, tier]) => {
    const agentRole = role as AgentRole;
    const index = AGENT_MODEL_INDEX_MAP[agentRole] ?? 0;
    return [role, getModelFromTier(tier, index)];
  })
) as Record<AgentRole, string>;

// Map roles to template files
export const AGENT_TEMPLATE_MAP: Record<AgentRole, string> = {
  [AgentRole.COMMAND_EXECUTOR]: 'command-executor',
  [AgentRole.PYTHON_CODER]: 'python-coder',
  [AgentRole.JS_TS_CODER]: 'js-ts-coder',
  [AgentRole.DEVOPS_ENGINEER]: 'devops-engineer',
  [AgentRole.ARCHITECT]: 'architect',
  [AgentRole.CODE_REVIEWER]: 'code-reviewer',
  [AgentRole.DOCUMENTATION_WRITER]: 'documentation-writer',
  [AgentRole.DBA]: 'dba',
  [AgentRole.RESEARCHER]: 'researcher',
};

// Tasks that use agentic loop
export const AGENTIC_TASKS: Set<TaskType> = new Set([
  TaskType.CODING_IMPLEMENTATION,
  TaskType.DEVOPS_IMPLEMENTATION,
  TaskType.DATABASE_DESIGN,
  TaskType.CODE_REVIEW,
]);

// Map task types to prompt categories for simple/technical-simple flows
export const TASK_TYPE_TO_PROMPT: Record<string, string> = {
  // Technical simple (no tools needed)
  [TaskType.TECHNICAL_QA]: 'technical-qa',
  [TaskType.ARCHITECTURE_ANALYSIS]: 'architecture-analysis',
  [TaskType.DOC_SEARCH]: 'doc-search',
  
  // Non-technical
  [TaskType.EXPLANATION]: 'explanation',
  [TaskType.SOCIAL]: 'social',
  [TaskType.GENERAL_CONVO]: 'general',
  [TaskType.WRITING]: 'general',
};

// Map task types to tier indices for simple flows
// This allows fine-grained control over which model in a tier to use
export const TASK_TYPE_TO_TIER_INDEX: Record<string, { tier: keyof typeof MODEL_TIERS; index: number }> = {
  // Technical simple (no tools)
  [TaskType.TECHNICAL_QA]: { tier: 'tier3', index: 3 },
  [TaskType.ARCHITECTURE_ANALYSIS]: { tier: 'tier3', index: -1 },
  [TaskType.DOC_SEARCH]: { tier: 'tier2', index: 0 },
  
  // Non-technical
  [TaskType.EXPLANATION]: { tier: 'tier2', index: 2 },
  [TaskType.SOCIAL]: { tier: 'tier1', index: 0 },
  [TaskType.GENERAL_CONVO]: { tier: 'tier1', index: 2 },
  [TaskType.WRITING]: { tier: 'tier3', index: 0 },
};

// Helper function to get model from tier and index
function getModelFromTierIndex(tier: keyof typeof MODEL_TIERS, index: number): string {
  return getModelFromTier(tier, index);
}

// Backward compatibility: Map task types to models
export const TASK_TYPE_TO_MODEL: Record<string, string> = Object.fromEntries(
  Object.entries(TASK_TYPE_TO_TIER_INDEX).map(([taskType, config]) => [
    taskType,
    getModelFromTierIndex(config.tier, config.index),
  ])
);

// Max turns by complexity
export const MAX_TURNS_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  [TaskComplexity.SIMPLE]: 10,
  [TaskComplexity.MEDIUM]: 20,
  [TaskComplexity.COMPLEX]: 35,
};

// Checkpoint intervals by complexity
export const CHECKPOINT_INTERVAL_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  [TaskComplexity.SIMPLE]: 3,
  [TaskComplexity.MEDIUM]: 5,
  [TaskComplexity.COMPLEX]: 5,
};

export function getTemplateForAgent(role: AgentRole): string {
  return AGENT_TEMPLATE_MAP[role] || 'coding';
}

/**
 * Gets the default model for an agent role
 * 
 * @param role - The agent role
 * @param preferredModel - Optional: Override with a specific model from the tier
 * @returns Model name
 */
export function getModelForAgent(role: AgentRole, preferredModel?: string): string {
  // If preferred model specified and it's in the role's tier, use it
  if (preferredModel) {
    const tier = AGENT_MODEL_TIER_MAP[role];
    const tierModels = MODEL_TIERS[tier] as readonly string[];
    if (tierModels.includes(preferredModel)) {
      return preferredModel;
    }
  }
  
  // Get tier and index for this role
  const tier = AGENT_MODEL_TIER_MAP[role];
  const index = AGENT_MODEL_INDEX_MAP[role] ?? 0; // Default to first model
  
  // Get model from tier at specified index
  return getModelFromTier(tier, index);
}

export function shouldUseAgenticLoop(taskType: TaskType): boolean {
  return AGENTIC_TASKS.has(taskType);
}

export function getMaxTurns(complexity: TaskComplexity, estimated?: number): number {
  const base = MAX_TURNS_BY_COMPLEXITY[complexity] || 20;
  return estimated && estimated > 0 ? Math.min(estimated, base) : base;
}

export function getCheckpointInterval(complexity: TaskComplexity): number {
  return CHECKPOINT_INTERVAL_BY_COMPLEXITY[complexity] || 5;
}

export function getPromptForTaskType(taskType: TaskType): string {
  return TASK_TYPE_TO_PROMPT[taskType] || 'general';
}

export function getModelForTaskType(taskType: TaskType): string {
  const config = TASK_TYPE_TO_TIER_INDEX[taskType];
  if (config) {
    return getModelFromTierIndex(config.tier, config.index);
  }
  return 'general';
}
