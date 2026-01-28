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
  ]);

  return skipPlanningTasks.has(taskType);
}

/**
 * Tasks that need full sequential thinking (session + tools + planning)
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

export function isBranchRequest(message: string): boolean {
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

  return branchTriggers.some(trigger => lower.includes(trigger));
}

export function classifyFlow(
  isTechnical: boolean,
  taskType?: TaskType,
  useAgenticLoop?: boolean,
  filterContext?: FilterContext,
  message?: string
): FlowType {
  log.info(`Classification: is_technical=${isTechnical}, task_type=${taskType || 'undefined'}, use_agentic_loop=${useAgenticLoop || false}`);

  // 1. Check for breakglass flow
  if (filterContext?.is_breakglass) {
    log.info(`Routing to: BREAKGLASS flow`);
    return FlowType.BREAKGLASS;
  }

  // 2. Check for branch flow (multi-solution brainstorming)
  if (message && isBranchRequest(message)) {
    log.info(`Routing to: BRANCH flow (detected multi-solution request)`);
    return FlowType.BRANCH;
  }

  const effectiveTaskType = taskType || inferTaskType(isTechnical);

  // 3. Check for sequential thinking (merged agentic + technical)
  if (useAgenticLoop || needsSequentialThinking(effectiveTaskType)) {
    log.info(`Routing to: SEQUENTIAL_THINKING flow for ${effectiveTaskType}`);
    return FlowType.SEQUENTIAL_THINKING;
  }

  // 4. Default to simple flow
  log.info(`Routing to: SIMPLE flow for ${effectiveTaskType}`);
  return FlowType.SIMPLE;
}
