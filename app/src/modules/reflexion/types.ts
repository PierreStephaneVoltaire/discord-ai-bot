export interface TrajectoryEvaluation {
    score: number;              // 0-100 confidence score
    reasoning: string;          // Why this score
    has_progress: boolean;      // Did we make meaningful progress?
    issues: string[];           // Problems identified
    suggestions: string[];      // Improvement hints
    task_completion: number;    // 0-100 how much of task completed
    code_quality: number;       // 0-100 quality of implementation
    efficiency: number;         // 0-100 efficient use of turns
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

export interface TrajectorySummary {
    total_turns: number;
    tools_used: string[];
    files_modified: string[];
    errors_encountered: number;
    completion_status: 'complete' | 'incomplete' | 'failed';
}
