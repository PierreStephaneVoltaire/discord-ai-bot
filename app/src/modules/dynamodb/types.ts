export interface SubTopic {
  plan_file: string;
  instruction_file: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface EscalationEvent {
  turnNumber: number;
  fromModel: string;
  toModel: string;
  reason: string;
  timestamp: string;
}

export interface Reflection {
  timestamp: string;
  score: number;
  what_worked: string;
  what_failed: string;
  root_cause: string;
  strategy_change: string;
  key_insight: string;
}

export interface Session {
  thread_id: string;
  branch_name: string;
  topic_summary: string;
  has_progress: boolean;
  confidence_score: number;
  last_discord_timestamp: string;
  last_message: string;
  created_at: string;
  sub_topics: Record<string, SubTopic>;

  // NEW: Workspace & S3 fields
  workspace_path?: string;
  s3_prefix?: string;
  synced_files?: string[];
  current_plan?: string;

  // NEW: Reflexion fields
  reflections?: Reflection[];           // Last N reflections (sliding window)
  key_insights?: string[];              // Persistent learnings
  last_trajectory_summary?: string;     // Summary of previous execution

  // NEW: Execution tracking fields
  agent_role?: string;                  // Current agent role
  model?: string;                       // Current model being used
  current_turn?: number;                // Current turn number
  max_turns?: number;                   // Maximum turns allowed
  checkpoint?: boolean;                 // Whether checkpoint is active
  last_sync?: string;                   // Last S3 sync timestamp
  escalations?: EscalationEvent[];      // Escalation history
  flow_override?: string;               // Flow override for next execution

  // NEW: Poll history
  poll_entries?: PollHistoryEntry[];
}

export interface Execution {
  execution_id: string;
  thread_id: string;
  message_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
  model_used?: string;
  error?: string;
  input_context?: Record<string, unknown>;
  opus_response?: Record<string, unknown>;
  gemini_response?: Record<string, unknown>;
  ttl?: number;
}

export interface PollHistoryEntry {
  question: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
  }>;
  selectedOption: string;
  selectedBy: string;
  timestamp: string;
}

export interface SessionUpdate {
  topic_summary?: string;
  has_progress?: boolean;
  confidence_score?: number;
  last_discord_timestamp?: string;
  last_message?: string;
  sub_topics?: Record<string, SubTopic>;

  // NEW: Workspace & S3 fields
  workspace_path?: string;
  s3_prefix?: string;
  synced_files?: string[];
  current_plan?: string;

  // NEW: Reflexion fields
  reflections?: Reflection[];
  key_insights?: string[];
  last_trajectory_summary?: string;

  // NEW: Execution tracking fields
  agent_role?: string;
  model?: string;
  current_turn?: number;
  max_turns?: number;
  checkpoint?: boolean;
  last_sync?: string;
  escalations?: EscalationEvent[];
  flow_override?: string;

  // NEW: Poll history
  poll_entries?: PollHistoryEntry[];
}

export interface ExecutionUpdate {
  status?: Execution['status'];
  completed_at?: string;
  model_used?: string;
  error?: string;
  input_context?: Record<string, unknown>;
  opus_response?: Record<string, unknown>;
  gemini_response?: Record<string, unknown>;
}
