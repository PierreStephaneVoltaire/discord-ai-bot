import { generatePlan } from '../modules/litellm/opus';
import { createLogger } from '../utils/logger';
import { streamProgressToDiscord } from '../modules/agentic/progress';
import type { Session } from '../modules/dynamodb/types';
import type { PlanningResult } from '../modules/litellm/types';
import type { FormattedHistory, ProcessedAttachment } from './types';
import type { TrajectoryEvaluation } from '../modules/reflexion/types';
import {
  formatReflectionsForPrompt,
  formatKeyInsightsForPrompt,
  formatEvaluationForPrompt,
} from '../modules/reflexion/memory';
import { getConfig } from '../config';

const log = createLogger('PLANNING');

export interface PlanningInput {
  threadId: string;
  branchName: string;
  session: Session;
  history: FormattedHistory;
  processedAttachments: ProcessedAttachment[];
  userAddedFilesMessage?: string;
  previousConfidence?: number;
  previousEvaluation?: TrajectoryEvaluation | null; // NEW: Reflexion
}

export async function createPlan(input: PlanningInput): Promise<PlanningResult> {
  log.info(`Generating plan for thread ${input.threadId}`);
  log.info(`Existing topics: ${JSON.stringify(Object.keys(input.session.sub_topics || {}))}`);

  const attachmentNames = input.processedAttachments
    .map((a) => a.filename)
    .join(', ') || 'None';

  // Format Reflexion context
  const evalContext = formatEvaluationForPrompt(input.previousEvaluation || null);
  const reflections = formatReflectionsForPrompt(input.session.reflections);
  const keyInsights = formatKeyInsightsForPrompt(input.session.key_insights);

  log.info(`Calling Opus for planning (with Reflexion context)`);

  // Show planning progress in Discord
  await streamProgressToDiscord(input.threadId, {
    type: 'planning',
    model: getConfig().PLANNER_MODEL_ID,
    phase: 'planning'
  });

  const result = await generatePlan(
    {
      thread_id: input.threadId,
      branch_name: input.branchName,
      sub_topics: JSON.stringify(input.session.sub_topics || {}),
      history: input.history.formatted_history,
      message: input.history.current_message,
      attachments: attachmentNames,
      user_added_files: input.userAddedFilesMessage || '',
      previous_confidence: input.previousConfidence || 0,
      workspace_path: input.session.workspace_path || `/workspace/${input.threadId}`,

      // Reflexion context
      trajectory_summary: input.session.last_trajectory_summary || 'No previous execution.',
      ...evalContext,
      reflections,
      key_insights: keyInsights,
    },
    input.threadId
  );

  // Show prompt ready in Discord
  await streamProgressToDiscord(input.threadId, {
    type: 'prompt_ready',
    promptPreview: result.reformulated_prompt.substring(0, 200)
  });

  log.info(`Planning result:`);
  log.info(`  topic_slug: ${result.topic_slug}`);
  log.info(`  is_new_topic: ${result.is_new_topic}`);
  log.info(`  confidence_score: ${result.confidence_assessment.score}`);
  log.info(`  has_progress: ${result.confidence_assessment.has_progress}`);
  if (result.reflection) {
    log.info(`  reflection_key_insight: ${result.reflection.key_insight}`);
  }
  log.info(`Reformulated prompt length: ${result.reformulated_prompt.length}`);

  return result;
}
