export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required?: string[];
    };
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  tools?: Tool[];
  tool_choice?: string | { type: string; function: { name: string } };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Task classification enums
export enum TaskType {
  // Implementation
  CODING_IMPLEMENTATION = 'coding-implementation',
  DEVOPS_IMPLEMENTATION = 'devops-implementation',
  DATABASE_DESIGN = 'database-design',

  // Analysis
  TECHNICAL_QA = 'technical-qa',
  ARCHITECTURE_ANALYSIS = 'architecture-analysis',
  CODE_REVIEW = 'code-review',
  DOC_SEARCH = 'doc-search',

  // Execution
  TOOL_EXECUTION = 'tool-execution',
  COMMAND_RUNNER = 'command-runner',
  TEST_RUNNER = 'test-runner',

  // Communication
  EXPLANATION = 'explanation',
  DOCUMENTATION_WRITER = 'documentation-writer',
  GENERAL_CONVO = 'general-convo',
  SOCIAL = 'social',
  WRITING = 'writing',
}

export enum AgentRole {
  COMMAND_EXECUTOR = 'command-executor',
  PYTHON_CODER = 'python-coder',
  JS_TS_CODER = 'js-ts-coder',
  DEVOPS_ENGINEER = 'devops-engineer',
  ARCHITECT = 'architect',
  CODE_REVIEWER = 'code-reviewer',
  DOCUMENTATION_WRITER = 'documentation-writer',
  DBA = 'dba',
  RESEARCHER = 'researcher',
}

export enum FlowType {
  SIMPLE = 'simple',
  TECHNICAL_SIMPLE = 'technical-simple',
  TECHNICAL = 'technical',
  AGENTIC = 'agentic',
  BREAKGLASS = 'breakglass',
}

export enum TaskComplexity {
  SIMPLE = 'simple',
  MEDIUM = 'medium',
  COMPLEX = 'complex',
}

export interface EscalationEvent {
  turnNumber: number;
  fromModel: string;
  toModel: string;
  reason: string;
  timestamp: string;
}

// Agentic execution types
export interface AgenticExecutionConfig {
  maxTurns: number;
  currentTurn: number;
  model: string;
  agentRole: AgentRole;
  tools: Tool[];
  checkpointInterval: number;
}

export interface ExecutionState {
  turnNumber: number;
  confidenceScore: number;
  lastError: string | null;
  errorCount: number;
  sameErrorCount: number;
  fileChanges: string[];
  testResults: Array<{ name: string; passed: boolean }>;
  userInterrupts: Array<{ type: string; message?: string }>;
  userCorrectionCount: number;
  noProgressTurns: number;
  escalations: EscalationEvent[];
}

export interface ExecutionTurn {
  turnNumber: number;
  input: string;
  toolCalls: ToolCall[];
  toolResults: Array<{ tool: string; result: unknown }>;
  response: string;
  thinking?: string;
  confidence: number;
  status: 'continue' | 'stuck' | 'complete' | 'needs_clarification';
  modelUsed: string;
}

export interface InterruptCommand {
  type: 'STOP' | 'CLARIFY' | 'RETRY' | 'CONTINUE' | 'WRONG' | 'ESCALATE';
  message?: string;
  timestamp: string;
}

export interface ShouldRespondResult {
  should_respond: boolean;
  reason: string;
  is_technical: boolean;
  task_type: TaskType;
  agent_role?: AgentRole;
  complexity?: TaskComplexity;
}

export interface PlanningResult {
  reformulated_prompt: string;
  topic_slug: string;
  is_new_topic: boolean;
  plan_content: string;
  instruction_content: string;
  task_type: TaskType;
  agent_role: AgentRole;
  complexity: TaskComplexity;
  estimated_turns: number;
  skip_planning: boolean;
  use_agentic_loop: boolean;
  confidence_assessment: {
    has_progress: boolean;
    score: number;
    reasoning: string;
  };
}

export interface ShouldRespondContext {
  author: string;
  force_respond: boolean;
  is_secondary_bot: boolean;
  history: string;
  message: string;
}

export interface PlanningContext {
  thread_id: string;
  branch_name: string;
  sub_topics: string;
  history: string;
  message: string;
  attachments: string;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ExecuteContext {
  systemPrompt: string;
  userPrompt: string;
  branchName: string;
  model?: string;
}
