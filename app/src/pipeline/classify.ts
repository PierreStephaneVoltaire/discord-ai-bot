import { createLogger } from '../utils/logger';
import { TaskType, FlowType } from '../modules/litellm/types';
import type { FilterContext } from './types';

const log = createLogger('CLASSIFY');

export function inferTaskType(isTechnical: boolean): TaskType {
  return isTechnical ? TaskType.CODING_IMPLEMENTATION : TaskType.GENERAL_CONVO;
}

export function shouldSkipPlanning(taskType: TaskType): boolean {
  const skipPlanningTasks = new Set([
    TaskType.TECHNICAL_QA,
    TaskType.DOC_SEARCH,
    TaskType.EXPLANATION,
    TaskType.SOCIAL,
    TaskType.GENERAL_CONVO,
    TaskType.SHELL_COMMAND,  // Shell commands don't need planning
  ]);

  return skipPlanningTasks.has(taskType);
}

/**
 * Tasks that need full sequential thinking (session + tools + planning)
 * These tasks involve CODE GENERATION and EXECUTION
 */
export function needsSequentialThinking(taskType: TaskType): boolean {
  const sequentialTasks = new Set([
    TaskType.CODING_IMPLEMENTATION,
    TaskType.DEVOPS_IMPLEMENTATION,
    TaskType.DATABASE_DESIGN,
    TaskType.CODE_REVIEW,
    TaskType.DOCUMENTATION_WRITER,
    TaskType.TOOL_EXECUTION,
    TaskType.COMMAND_RUNNER,
    TaskType.TEST_RUNNER,
  ]);

  return sequentialTasks.has(taskType);
}

/**
 * Tasks that are architecture/design focused (NO code generation)
 * These tasks generate PLANS and DESIGNS only
 */
export function needsArchitectureFlow(taskType: TaskType): boolean {
  const architectureTasks = new Set([
    TaskType.ARCHITECTURE_ANALYSIS,
    TaskType.TECHNICAL_QA,  // Can be architecture if asking about design
  ]);

  return architectureTasks.has(taskType);
}

export function isBranchRequest(message: string, confidenceScore?: number): boolean {
  const lower = message.toLowerCase();

  // Branch flow triggers: Architectural exploration, multiple approaches, theoretical discussion
  const branchTriggers = [
    'multiple solutions',
    'explore options',
    'what are my options',
    'different approaches',
    'different ways',
    'brainstorm',
    'think of alternatives',
    'alternative approaches',
    'architectural options',
    'compare approaches',
    'pros and cons',
    'tradeoffs',
    'trade-offs',
    'which approach',
    'explore architectures',
    'design options',
  ];

  const hasTrigger = branchTriggers.some(trigger => lower.includes(trigger));
  
  // Also trigger branch flow if confidence is below 60
  const lowConfidence = confidenceScore !== undefined && confidenceScore < 60;
  
  if (lowConfidence) {
    log.info(`Branch flow triggered due to low confidence: ${confidenceScore}`);
  }
  
  return hasTrigger || lowConfidence;
}

export function classifyFlow(
  isTechnical: boolean,
  taskType?: TaskType,
  useAgenticLoop?: boolean,
  filterContext?: FilterContext,
  message?: string,
  confidenceScore?: number
): FlowType {
  log.info(`Classification: is_technical=${isTechnical}, task_type=${taskType || 'undefined'}, use_agentic_loop=${useAgenticLoop || false}`);

  // 1. Check for breakglass flow
  if (filterContext?.is_breakglass) {
    log.info(`Routing to: BREAKGLASS flow`);
    return FlowType.BREAKGLASS;
  }

  // 2. Check for branch flow (multi-solution brainstorming or low confidence)
  if (message && isBranchRequest(message, confidenceScore)) {
    log.info(`Routing to: BRANCH flow (detected multi-solution request or low confidence)`);
    return FlowType.BRANCH;
  }

  const effectiveTaskType = taskType || inferTaskType(isTechnical);

  // 3. Check for social flow (casual chat, greetings)
  if (effectiveTaskType === TaskType.SOCIAL) {
    log.info(`Routing to: SOCIAL flow for ${effectiveTaskType}`);
    return FlowType.SOCIAL;
  }

  // 4. Check for proofreader flow (grammar/spellcheck only)
  if (effectiveTaskType === TaskType.PROOFREADER) {
    log.info(`Routing to: PROOFREADER flow for ${effectiveTaskType}`);
    return FlowType.PROOFREADER;
  }

  // 5. Check for shell command flow (suggesting commands, not executing)
  if (effectiveTaskType === TaskType.SHELL_COMMAND) {
    log.info(`Routing to: SHELL flow for shell command suggestions`);
    return FlowType.SHELL;
  }

  // 6. Check for architecture flow (design/planning WITHOUT code generation)
  if (needsArchitectureFlow(effectiveTaskType)) {
    log.info(`Routing to: ARCHITECTURE flow for ${effectiveTaskType}`);
    return FlowType.ARCHITECTURE;
  }

  // 5. Check for sequential thinking (merged agentic + technical - WITH code generation)
  if (useAgenticLoop || needsSequentialThinking(effectiveTaskType)) {
    log.info(`Routing to: SEQUENTIAL_THINKING flow for ${effectiveTaskType}`);
    return FlowType.SEQUENTIAL_THINKING;
  }

  // 5. Default to simple flow
  log.info(`Routing to: SIMPLE flow for ${effectiveTaskType}`);
  return FlowType.SIMPLE;
}
