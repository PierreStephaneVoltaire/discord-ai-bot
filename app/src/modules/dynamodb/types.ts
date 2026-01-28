export interface SubTopic {
  plan_file: string;
  instruction_file: string;
  status: 'pending' | 'in_progress' | 'completed';
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
