import type { DiscordMessagePayload, DiscordAttachment } from '../modules/discord/types';
import type { Session, PollHistoryEntry } from '../modules/dynamodb/types';
import type { PlanningResult } from '../modules/litellm/types';

export interface FilterContext {
  is_self: boolean;
  is_stale: boolean;
  is_mentioned: boolean;
  is_secondary_bot: boolean;
  force_respond: boolean;
  is_breakglass: boolean;
  breakglass_model?: string;
}

export interface FilterResult {
  passed: boolean;
  reason?: string;
  context: FilterContext;
}

export interface ThreadContext {
  is_thread: boolean;
  thread_id: string | null;
  channel_id: string;
  channel_name: string;
  channel_type: number;
  parent_id: string | null;
}

export interface AttachmentCategory {
  images: DiscordAttachment[];
  textFiles: DiscordAttachment[];
  otherFiles: DiscordAttachment[];
}

export interface FormattedHistory {
  formatted_history: string;
  current_message: string;
  current_author: string;
  current_attachments: AttachmentCategory;
  poll_entries?: PollHistoryEntry[];
}

export interface ProcessedAttachment {
  filename: string;
  url: string;
  content_type?: string;
  base64?: string;
  error?: string;
}

export interface PipelineContext {
  execution_id: string;
  message: DiscordMessagePayload;
  filter: FilterContext;
  thread: ThreadContext;
  history: FormattedHistory;
  should_respond: boolean;
  is_technical: boolean;
  decision_reason: string;
  session: Session | null;
  branch_name: string;
  is_new_session: boolean;
  processed_attachments: ProcessedAttachment[];
  planning: PlanningResult | null;
  response: string;
  model_used: string;
}

export interface PipelineResult {
  success: boolean;
  execution_id: string;
  responded: boolean;
  error?: string;
}
