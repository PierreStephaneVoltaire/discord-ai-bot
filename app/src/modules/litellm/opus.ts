import { chatCompletion, extractContent, extractJsonFromContent } from './index';
import { loadTemplate, renderTemplate } from '../../templates/loader';
import { createLogger } from '../../utils/logger';
import { shouldUseAgenticLoop } from '../../templates/registry';
import type {
  ShouldRespondContext,
  ShouldRespondResult,
  PlanningContext,
  PlanningResult,
  TaskType,
  AgentRole,
  TaskComplexity,
} from './types';

const log = createLogger('LITELLM:OPUS');

const DEFAULT_SHOULD_RESPOND: ShouldRespondResult = {
  should_respond: false,
  reason: 'Could not parse response',
  is_technical: false,
  task_type: 'general-convo' as TaskType,
};

const DEFAULT_PLANNING: PlanningResult = {
  reformulated_prompt: '',
  topic_slug: 'general-task',
  is_new_topic: true,
  plan_content: '## Objective\nComplete the requested task.',
  instruction_content: '## Rules\nFollow best practices.',
  task_type: 'coding-implementation' as TaskType,
  agent_role: 'python-coder' as AgentRole,
  complexity: 'medium' as TaskComplexity,
  estimated_turns: 15,
  skip_planning: false,
  use_agentic_loop: false,
  confidence_assessment: {
    has_progress: true,
    score: 50,
    reasoning: 'Default',
  },
};

export async function shouldRespond(
  context: ShouldRespondContext,
  messageId: string
): Promise<ShouldRespondResult> {
  log.info(`shouldRespond call for message ${messageId}`);

  const template = loadTemplate('should_respond');
  const systemPrompt = renderTemplate(template, {
    author: context.author,
    force_respond: String(context.force_respond),
    is_secondary_bot: String(context.is_secondary_bot),
    history: context.history,
    message: context.message,
  });

  const response = await chatCompletion({
    model: 'claude-opus-4.5',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Analyze the message and respond with JSON only.`,
      },
    ],
  });

  const content = extractContent(response);
  log.info(`shouldRespond raw response length: ${content.length}`);

  const parsed = extractJsonFromContent<ShouldRespondResult>(content);

  if (!parsed) {
    log.warn('Could not parse shouldRespond response, using defaults');
    return DEFAULT_SHOULD_RESPOND;
  }

  const result: ShouldRespondResult = {
    should_respond: parsed.should_respond === true,
    reason: parsed.reason || 'No reason given',
    is_technical: parsed.is_technical === true,
    task_type: parsed.task_type || ('general-convo' as TaskType),
    agent_role: parsed.agent_role,
    complexity: parsed.complexity,
  };

  log.info(`shouldRespond result: should_respond=${result.should_respond}, is_technical=${result.is_technical}`);
  log.info(`shouldRespond task_type=${result.task_type}, agent_role=${result.agent_role || 'undefined'}, complexity=${result.complexity || 'undefined'}`);
  log.info(`shouldRespond reason: ${result.reason}`);

  return result;
}

export async function generatePlan(
  context: PlanningContext,
  threadId: string
): Promise<PlanningResult> {
  log.info(`generatePlan for thread ${threadId}`);

  const template = loadTemplate('planning');
  const systemPrompt = renderTemplate(template, {
    thread_id: context.thread_id,
    branch_name: context.branch_name,
    sub_topics: context.sub_topics,
    history: context.history,
    message: context.message,
    attachments: context.attachments,
  });

  const response = await chatCompletion({
    model: 'claude-opus-4.5',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: 'Generate a plan and respond with JSON only.',
      },
    ],
  });

  const content = extractContent(response);
  log.info(`generatePlan raw response length: ${content.length}`);

  const parsed = extractJsonFromContent<PlanningResult>(content);

  if (!parsed) {
    log.warn('Could not parse planning response, using defaults');
    return {
      ...DEFAULT_PLANNING,
      reformulated_prompt: context.message,
    };
  }

  const taskType = parsed.task_type || ('coding-implementation' as TaskType);
  const agentRole = parsed.agent_role || ('python-coder' as AgentRole);
  const complexity = parsed.complexity || ('medium' as TaskComplexity);

  const result: PlanningResult = {
    reformulated_prompt: parsed.reformulated_prompt || context.message,
    topic_slug: parsed.topic_slug || 'general-task',
    is_new_topic: parsed.is_new_topic !== false,
    plan_content: parsed.plan_content || DEFAULT_PLANNING.plan_content,
    instruction_content: parsed.instruction_content || DEFAULT_PLANNING.instruction_content,
    task_type: taskType,
    agent_role: agentRole,
    complexity: complexity,
    estimated_turns: parsed.estimated_turns || 15,
    skip_planning: parsed.skip_planning === true,
    use_agentic_loop: shouldUseAgenticLoop(taskType),
    confidence_assessment: {
      has_progress: parsed.confidence_assessment?.has_progress !== false,
      score: parsed.confidence_assessment?.score ?? 50,
      reasoning: parsed.confidence_assessment?.reasoning || 'No reasoning provided',
    },
  };

  log.info(`generatePlan result: topic_slug=${result.topic_slug}, is_new_topic=${result.is_new_topic}`);
  log.info(`generatePlan task_type=${result.task_type}, agent_role=${result.agent_role}, complexity=${result.complexity}`);
  log.info(`generatePlan estimated_turns=${result.estimated_turns}, skip_planning=${result.skip_planning}, use_agentic_loop=${result.use_agentic_loop}`);
  log.info(`generatePlan confidence: score=${result.confidence_assessment.score}, has_progress=${result.confidence_assessment.has_progress}`);

  return result;
}

export async function generateThreadName(content: string): Promise<string> {
  log.info(`generateThreadName, input length: ${content.length}`);

  const template = loadTemplate('thread_name');

  const response = await chatCompletion({
    model: 'claude-opus-4.5',
    messages: [
      { role: 'system', content: template },
      { role: 'user', content: content.substring(0, 500) },
    ],
  });

  const name = extractContent(response).trim();
  log.info(`generateThreadName result: ${name}`);

  return name || content.substring(0, 50);
}
