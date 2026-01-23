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
 * Tasks that need MCP tools and session but can skip planning
 * These go through TECHNICAL flow but with skip_planning flag
 */
export function needsToolsButSkipsPlanning(taskType: TaskType): boolean {
  const toolTasksNoPlan = new Set([
    TaskType.TOOL_EXECUTION,
    TaskType.COMMAND_RUNNER,
    TaskType.TEST_RUNNER,
  ]);

  return toolTasksNoPlan.has(taskType);
}

/**
 * Tasks that need full technical flow (session + tools + planning)
 */
export function needsFullTechnicalFlow(taskType: TaskType): boolean {
  const fullTechnicalTasks = new Set([
    TaskType.CODING_IMPLEMENTATION,
    TaskType.DEVOPS_IMPLEMENTATION,
    TaskType.DATABASE_DESIGN,
    TaskType.CODE_REVIEW,
    TaskType.DOCUMENTATION_WRITER, // Needs tools for file creation + git
  ]);

  return fullTechnicalTasks.has(taskType);
}

export function classifyFlow(isTechnical: boolean, taskType?: TaskType, useAgenticLoop?: boolean, filterContext?: FilterContext): FlowType {
  log.info(`Classification: is_technical=${isTechnical}, task_type=${taskType || 'undefined'}, use_agentic_loop=${useAgenticLoop || false}`);

  // Check for breakglass flow first
  if (filterContext?.is_breakglass) {
    log.info(`Routing to: BREAKGLASS flow for model ${filterContext.breakglass_model}`);
    return FlowType.BREAKGLASS;
  }

  // If no task type provided, infer from is_technical for backward compatibility
  const effectiveTaskType = taskType || inferTaskType(isTechnical);

  // Check if agentic loop should be used
  if (useAgenticLoop) {
    log.info(`Routing to: AGENTIC flow for ${effectiveTaskType}`);
    return FlowType.AGENTIC;
  }

  // Check if this needs full technical flow (session + tools + planning)
  if (needsFullTechnicalFlow(effectiveTaskType)) {
    log.info(`Routing to: TECHNICAL flow for ${effectiveTaskType} (needs session + tools + planning)`);
    return FlowType.TECHNICAL;
  }

  // Check if this needs tools but can skip planning
  if (needsToolsButSkipsPlanning(effectiveTaskType)) {
    log.info(`Routing to: TECHNICAL flow for ${effectiveTaskType} (needs session + tools, planning skipped)`);
    return FlowType.TECHNICAL;
  }

  // Check if planning should be skipped (Q&A, explanations - no tools needed)
  if (shouldSkipPlanning(effectiveTaskType)) {
    const flowType = isTechnical ? FlowType.TECHNICAL_SIMPLE : FlowType.SIMPLE;
    log.info(`Routing to: ${flowType} flow (planning skipped for ${effectiveTaskType})`);
    return flowType;
  }

  // Default technical flow with planning
  const flowType = isTechnical ? FlowType.TECHNICAL : FlowType.SIMPLE;
  log.info(`Routing to: ${flowType} flow`);

  return flowType;
}
