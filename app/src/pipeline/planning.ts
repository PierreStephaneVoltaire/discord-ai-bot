import { generatePlan } from '../modules/litellm/opus';
import { createLogger } from '../utils/logger';
import type { Session } from '../modules/dynamodb/types';
import type { PlanningResult } from '../modules/litellm/types';
import type { FormattedHistory, ProcessedAttachment } from './types';

const log = createLogger('PLANNING');

export interface PlanningInput {
  threadId: string;
  branchName: string;
  session: Session;
  history: FormattedHistory;
  processedAttachments: ProcessedAttachment[];
}

export async function createPlan(input: PlanningInput): Promise<PlanningResult> {
  log.info(`Generating plan for thread ${input.threadId}`);
  log.info(`Existing topics: ${JSON.stringify(Object.keys(input.session.sub_topics || {}))}`);

  const attachmentNames = input.processedAttachments
    .map((a) => a.filename)
    .join(', ') || 'None';

  log.info(`Calling Opus for planning`);

  const result = await generatePlan(
    {
      thread_id: input.threadId,
      branch_name: input.branchName,
      sub_topics: JSON.stringify(input.session.sub_topics || {}),
      history: input.history.formatted_history,
      message: input.history.current_message,
      attachments: attachmentNames,
    },
    input.threadId
  );

  log.info(`Planning result:`);
  log.info(`  topic_slug: ${result.topic_slug}`);
  log.info(`  is_new_topic: ${result.is_new_topic}`);
  log.info(`  confidence_score: ${result.confidence_assessment.score}`);
  log.info(`  has_progress: ${result.confidence_assessment.has_progress}`);
  log.info(`Reformulated prompt length: ${result.reformulated_prompt.length}`);

  return result;
}
