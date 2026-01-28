import type { FormattedHistory, ProcessedAttachment, FilterContext } from '../types';

export interface FlowContext {
  threadId: string;
  channelId: string;
  messageId: string;
  history: FormattedHistory;
  filterContext: FilterContext;
  isThread: boolean;
  executionId: string;
  userAddedFilesMessage?: string; // NEW: Message about newly synced files
}

export interface FlowResult {
  response: string;
  model: string;
  branchName?: string;
  responseChannelId: string;
}
