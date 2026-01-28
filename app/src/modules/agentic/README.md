# Agentic Execution Module

Multi-turn autonomous execution system for complex tasks.

## Overview

The agentic module implements a sophisticated multi-turn execution loop that allows the bot to autonomously work on complex tasks, self-correct, escalate when stuck, and interact with users for clarification.

## Core Components

### Execution Loop (`loop.ts`)

Main orchestrator for multi-turn execution:

- Turn-based execution up to N turns (10-35 based on complexity)
- Tool integration using MCP tools for file operations, commands, etc.
- State tracking for confidence, errors, progress
- Checkpointing saves progress every 5 turns
- Abort handling respects user stop signals
- **Chain-of-Thought prompting** for step-by-step reasoning

**Key Function:**
- `executeSequentialThinkingLoop()` - Main entry point for sequential execution with CoT

**Returns:**
```typescript
{
  success: boolean,
  finalResponse: string,
  turns: ExecutionTurn[],      // Trajectory for Reflexion evaluation
  finalConfidence: number
}
```

### Confidence Calculation (`confidence.ts`)

Calculates execution confidence based on trajectory:

**Factors:**
- Progress indicators (file changes, successful commands)
- Error patterns (repeated failures)
- Tool effectiveness (successful vs failed tool calls)
- Completion signals from model

** Key Functions:**
- `calculateConfidence(state)` - Computes 0-100 confidence score
- `isStuck(state)` - Detects when execution is not progressing

### Execution Locks (`lock.ts`)

Thread-safe execution management:

- Per-thread locks prevent concurrent execution in same thread
- Abort flags allow graceful termination via 🛑 reaction
- Turn tracking monitors current turn number
- In-memory storage for fast access

**Key Functions:**
- `createLock()` - Create lock for thread
- `hasActiveLock()` - Check if thread is locked
- `abortLock()` - Set abort flag
- `releaseLock()` - Release lock when done

### User Interrupts (`interrupts.ts`)

Handles user intervention during execution:

**Interrupt Types:**
- **Stop** (🛑 reaction): Gracefully abort execution
- **Clarification**: Pause for user input
- **Feedback** (👍/👎 reactions): Adjust confidence

**Key Functions:**
- `checkForInterrupts()` - Check for user signals
- `handleInterrupt()` - Process interrupt appropriately
- `waitForUserInput()` - Pause until user responds

### Model Escalation (`escalation.ts`)

Automatic model switching when stuck:

**Model Tiers:**
- Tier 1: Ultra-fast, no tools (gemini-2.5-flash-lite)
- Tier 2: Fast with tools (gemini, gpt-4o-mini)
- Tier 3: Balanced (sonnet, gpt-4o)
- Tier 4: Premium (opus, o1)

**Escalation Triggers:**
- Confidence < 30% for 2 consecutive turns
- Same error repeats 3 times
- No file changes for 5 turns
- Model reports 'stuck' status
- User corrections >= 2

**Key Functions:**
- `checkEscalationTriggers()` - Determine if escalation needed
- `getNextModel()` - Get next model in ladder
- `isAtMaxEscalation()` - Check if at Opus already

### Progress Streaming (`progress.ts`)

Real-time Discord updates:

**Update Types:**
- `turn_start` - Beginning of turn
- `turn_complete` - End of turn with stats
- `tool_execution` - Tool being executed
- `checkpoint` - Progress saved
- `escalation` - Model upgraded
- `clarification_request` - Need user input

**Key Functions:**
- `streamProgressToDiscord()` - Send progress update
- `formatTurnUpdate()` - Format turn info for Discord

### Commit Management (`commits.ts`)

**⚠️ Note: This module manages Git branch operations but is NOT part of the primary S3 artifact workflow**

Git operations for branch-based development (optional workflow):

**Features:**
- Post commit messages with reaction options
- Track message ID → branch mapping
- Execute git merge/delete operations
- User approval flow with 👍/👎 reactions

**Key Functions:**
- `postCommitMessage()` - Post commit to Discord
- `registerCommitMessage()` - Register for reaction handling
- `mergeBranch()` - Merge branch to main
- `deleteBranch()` - Delete rejected branch

**When Used:**
- Branch flow (experimental/alternative development)
- User explicitly requests Git workflow
- **Not used in standard S3 artifact flow**

### Logging (`logging.ts`)

DynamoDB persistence for debugging:

**Logged Data:**
- Turn-by-turn execution details
- Tool calls and results
- Confidence scores
- File changes
- Errors

**Key Functions:**
- `logTurnToDb()` - Log single turn
- `logExecutionStart()` - Log start event
- `logExecutionComplete()` - Log completion

**Table Structure:**
```
pk: threadId
sk: TURN#{turn}#{timestamp}
ttl: 30 days auto-expire
```

### Event Emission (`events.ts`)

SQS events for external observability:

**Event Types:**
- `execution_started`
- `turn_completed`
- `model_escalated`
- `execution_completed`
- `execution_aborted`
- `commit_created` (if using Git workflow)
- `branch_merged` (if using Git workflow)
- `branch_rejected` (if using Git workflow)

**Key Functions:**
- `emitEvent()` - Generic event emitter
- `emitExecutionStarted()` - Start event
- `emitTurnCompleted()` - Turn event
- `emitModelEscalated()` - Escalation event

## Execution Flow

```
1. Create execution lock
2. Initialize workspace (sync from S3 if exists)
3. Log execution start
4. Emit started event
5. FOR each turn (up to maxTurns):
   a. Stream turn start to Discord
   b. Check for user interrupts (🛑)
   c. Get system prompt with Chain-of-Thought guidance
   d. Execute turn with LLM + MCP tools
   e. Parse tool calls and results
   f. Update execution state
   g. Calculate confidence
   h. Stream turn complete
   i. Check for completion/stuck
   j. Check escalation triggers
   k. Checkpoint if needed (every 5 turns)
6. Sync workspace to S3
7. Release lock
8. Log completion
9. Emit completed event
10. Return trajectory for Reflexion evaluation
```

## Integration with Reflexion

The execution loop now returns the full trajectory:

```typescript
const result = await executeSequentialThinkingLoop(...);

// Returns trajectory for evaluation
const evaluation = await evaluator.evaluateTrajectory(
  result.turns,        // All execution details
  originalTask,        // Task description
  maxTurns            // Max allowed turns
);
```

Reflexion then uses this to:
- Score execution quality (0-100)
- Identify what worked/failed
- Generate reflections for future attempts
- Store key insights in DynamoDB

## Configuration

**Environment Variables:**
- `DYNAMODB_EXECUTIONS_TABLE` - DynamoDB table for logs
- `AGENTIC_EVENTS_QUEUE_URL` - SQS queue URL for events
- `S3_ARTIFACT_BUCKET` - S3 bucket for workspace persistence

**Constants:**
- `MAX_TURNS_BY_COMPLEXITY` - 10/20/35 for simple/medium/complex
- `CHECKPOINT_INTERVAL` - Every 5 turns
- `MODEL_TIERS` - Model capability hierarchy

## Usage Example

```typescript
import { executeSequentialThinkingLoop } from './modules/agentic/loop';
import { getModelForAgent, getMaxTurns } from './templates/registry';

const result = await executeSequentialThinkingLoop(
  {
    maxTurns: getMaxTurns('medium', 20),
    currentTurn: 0,
    model: getModelForAgent('python-coder'),
    agentRole: 'python-coder',
    tools: await getTools(threadId),
    checkpointInterval: 5,
  },
  'Refactor the authentication module',
  threadId,
  80,  // Initial confidence
  `/workspace/${threadId}`
);

if (result.success) {
  console.log('Task completed!');
  console.log(`Final confidence: ${result.finalConfidence}%`);
  // Trajectory available in result.turns for Reflexion
} else {
  console.log('Task failed or aborted');
}
```

## Debugging

**View execution logs:**
```bash
aws dynamodb query \
  --table-name discord-messages \
  --key-condition-expression "pk = :threadId" \
  --expression-attribute-values '{":threadId":{"S":"1234567890"}}'
```

**Consume events:**
```bash
aws sqs receive-message \
  --queue-url $AGENTIC_EVENTS_QUEUE_URL \
  --max-number-of-messages 10
```

**Check workspace state:**
```bash
aws s3 ls s3://$S3_ARTIFACT_BUCKET/threads/<thread-id>/ --recursive
```

## Safety Features

1. Max turn limits prevent infinite loops
2. Abort flags allow user to stop execution anytime
3. Confidence monitoring detects when stuck
4. Model escalation automatically upgrades when struggling
5. Checkpointing saves progress regularly
6. Error tracking detects repeated failures
7. User clarification asks for help when truly stuck
8. Workspace isolation prevents cross-thread contamination
9. S3 persistence preserves state across restarts

## See Also

- [Reflexion Module](../reflexion/README.md) - Trial-and-error learning
- [Workspace Module](../workspace/README.md) - S3 artifact storage
- [Sequential-Thinking Flow](../../pipeline/flows/sequential-thinking.ts)
- [LiteLLM Integration](../litellm/README.md)
