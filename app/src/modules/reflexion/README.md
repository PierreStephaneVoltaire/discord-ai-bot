# Reflexion Module

Trial-and-error learning system that enables self-improvement through execution evaluation and reflection.

## Overview

Implements the Reflect ionpattern to help the bot learn from past attempts. After each execution, the system evaluates what worked and what didn't, storing insights for future runs.

## Components

### Evaluator (`evaluator.ts`)

Scores execution trajectories using heuristic-based metrics:

**Scoring Criteria:**
- **Task Completion** (50% weight): Commands/file operations executed, progress indicators
- **Code Quality** (30% weight): Error patterns, syntax checks, best practices
- **Efficiency** (20% weight): Turns used vs max allowed, repeated errors

**Output:**
```typescript
{
  score: 85,                    // 0-100
  reasoning: "Task completion: 90%, Code quality: 85%, Efficiency: 75%",
  progress: true,               // Better than previous attempt
  issues: ["Missing error handling in auth.ts"],
  suggestions: ["Add try-catch blocks", "Validate user input"]
}
```

**Key Function:**
- `evaluateTrajectory(turns, task, maxTurns)` - Main evaluation entry point

### Memory Management (`memory.ts`)

Manages reflection history with sliding windows and deduplication:

**Stored Data:**
- **Reflections**: Last 5 attempts (sliding window)
- **Key Insights**: Top 20 persistent learnings
- **Trajectory Summary**: Brief stats from last execution

**Key Functions:**
- `addReflectionToHistory()` - Adds reflection, keeps last 5
- `addKeyInsight()` - Deduplicates and adds insight, max 20
- `formatReflectionsForPrompt()` - Formats for Opus context
- `formatEvaluationForPrompt()` - Formats evaluation scores
- `formatKeyInsightsForPrompt()` - Formats insights list

**Deduplication:**
```typescript
// Compares first 20 chars (case-insensitive)
const isDuplicate = existing.slice(0, 20).toLowerCase() === 
                   newInsight.slice(0, 20).toLowerCase();
```

### Types (`types.ts`)

TypeScript interfaces for Reflexion data structures:

```typescript
interface Reflection {
  timestamp: string;
  score: number;           // From evaluator
  what_worked: string;     // From Opus reflection
  what_failed: string;
  root_cause: string;
  strategy_change: string;
  key_insight: string;
}

interface Evaluation {
  score: number;
  reasoning: string;
  progress: boolean;
  issues: string[];
  suggestions: string[];
}
```

## How It Works

### 1. Before Execution (Planning)

Opus receives context from previous attempts:

```
### Previous Execution
Score: 65%
Task Completion: 70%, Code Quality: 60%, Efficiency: 65%
Issues: ["Missing tests", "No error handling"]
Suggestions: ["Add unit tests", "Implement try-catch blocks"]

### Reflection History
Reflection 1 (2024-01-20T10:30:00Z)
- Score: 65%
- What Worked: Basic CRUD operations implemented
- What Failed: Tests not written, errors unhandled
- Root Cause: Focused only on happy path
- Strategy Change: Write tests first, then implementation

### Key Insights
1. Always implement error handling alongside business logic
2. Unit tests catch integration issues early
```

### 2. During Execution (Implementation)

Model implements with Chain-of-Thought reasoning, informed by past reflections.

### 3. After Execution (Evaluation & Reflection)

**Evaluator scores the trajectory:**
```typescript
const evaluation = await trajectoryEvaluator.evaluateTrajectory(
  turns,           // All execution turns
  task,            // Original task description
  maxTurns         // Max allowed turns
);
// → { score: 85, reasoning: "...", issues: [...], suggestions: [...] }
```

**Opus generates reflection:**
```json
{
  "what_worked": "Implemented auth with proper middleware",
  "what_failed": "Forgot to hash passwords initially",
  "root_cause": "Didn't check security best practices first",
  "strategy_change": "Review security checklist before implementation",
  "key_insight": "Always hash passwords before storing in database"
}
```

**Memory updated:**
```typescript
// Add to sliding window (last 5)
const updatedReflections = addReflectionToHistory(
  session.reflections,
  newReflection
);

// Add to persistent insights (max 20, deduplicated)
const updatedInsights = addKeyInsight(
  session.key_insights,
  "Always hash passwords before storing in database"
);

// Save to DynamoDB
await updateSession(threadId, {
  reflections: updatedReflections,
  key_insights: updatedInsights,
  last_trajectory_summary: "Turns: 8, Tools: write_file, execute_command, Status: success"
});
```

### 4. Next Execution

Opus sees updated context and adjusts strategy based on learnings.

## Integration Points

### DynamoDB Schema

Added to `Session` interface:

```typescript
interface Session {
  // ... existing fields
  reflections?: Reflection[];           // Last 5
  key_insights?: string[];              // Top 20
  last_trajectory_summary?: string;     // Brief stats
}
```

### Planning Flow

`planning.ts` passes Reflexion context to Opus:

```typescript
const result = await generatePlan({
  // ... existing context
  trajectory_summary: session.last_trajectory_summary,
  prev_score: previousEval?.score,
  prev_issues: previousEval?.issues.join(', '),
  prev_suggestions: previousEval?.suggestions.join(', '),
  reflections: formatReflectionsForPrompt(session.reflections),
  key_insights: formatKeyInsightsForPrompt(session.key_insights),
});
```

### Sequential-Thinking Flow

`flows/sequential-thinking.ts` integrates evaluation:

```typescript
// Before: Pass previous evaluation to planning
const planning = await createPlan({
  previousEvaluation: session.last_evaluation,
  // ...
});

// After execution: Evaluate and reflect
const evaluation = await evaluator.evaluateTrajectory(...);
const reflection = buildReflection(planning.reflection, evaluation);

// Save to DynamoDB
await updateSession(threadId, {
  reflections: addReflectionToHistory(session.reflections, reflection),
  key_insights: addKeyInsight(session.key_insights, reflection.key_insight),
  last_trajectory_summary: generateSummary(turns),
});
```

## Performance Characteristics

**Evaluator:**
- Heuristic-based (no LLM calls) for speed
- Completes in ~5-10ms per trajectory
- No API costs

**Memory:**
- Sliding windows keep data bounded
- Max 5 reflections + 20 insights per session
- ~2-3KB of text data per session

**DynamoDB:**
- Single `updateSession()` call after execution
- Eventual consistency acceptable
- TTL can auto-expire old sessions

## Example Output

**First Attempt:**
```
Score: 50%
What Worked: Basic structure created
What Failed: Missing tests, no error handling
Key Insight: Always implement error handling alongside features
```

**Second Attempt (with learning):**
```
Score: 85%
What Worked: Error handling included from start, tests written
What Failed: Performance not optimized
Key Insight: Consider performance implications early in design
```

**Third Attempt:**
```
Score: 95%
What Worked: Complete implementation with tests, error handling, and optimizations
What Failed: Minor - could improve logging
Key Insight: Structured logging helps debugging production issues
```

## Configuration

No environment variables required. Uses existing DynamoDB session storage.

**Constants:**
- `MAX_REFLECTIONS = 5` - Sliding window size
- `MAX_KEY_INSIGHTS = 20` - Max persistent learnings
- Evaluation weights: 50% task completion, 30% code quality, 20% efficiency

## See Also

- [Sequential-Thinking Flow](../../pipeline/flows/sequential-thinking.ts)
- [Planning Module](../../pipeline/planning.ts)
- [DynamoDB Types](../dynamodb/types.ts)
