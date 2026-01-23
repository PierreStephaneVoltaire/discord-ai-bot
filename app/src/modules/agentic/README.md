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

**Key Function:**
- `executeAgenticLoop()` - Main entry point for agentic execution

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
- `postCommitMessage()` - Post commit with 👍/👎 reactions

### Commit Management (`commits.ts`)

Git operations and commit message handling:

**Features:**
- Post commit messages with reaction options
- Track message ID → branch mapping
- Execute git merge/delete operations

**Key Functions:**
- `postCommitMessage()` - Post commit to Discord
- `registerCommitMessage()` - Register for reaction handling
- `mergeBranch()` - Merge branch to main
- `deleteBranch()` - Delete rejected branch

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
- `commit_created`
- `branch_merged`
- `branch_rejected`

**Key Functions:**
- `emitEvent()` - Generic event emitter
- `emitExecutionStarted()` - Start event
- `emitTurnCompleted()` - Turn event
- `emitModelEscalated()` - Escalation event

## Execution Flow

```
1. Create execution lock
2. Log execution start
3. Emit started event
4. FOR each turn (up to maxTurns):
   a. Stream turn start to Discord
   b. Check for user interrupts (🛑)
   c. Execute turn with LLM + tools
   d. Update execution state
   e. Calculate confidence
   f. Stream turn complete
   g. Check for completion
   h. Check escalation triggers
   i. Checkpoint if needed
5. Release lock
6. Log completion
7. Emit completed event
```

## Configuration

**Environment Variables:**
- `DYNAMODB_EXECUTIONS_TABLE` - DynamoDB table for logs
- `AGENTIC_EVENTS_QUEUE_URL` - SQS queue URL for events

**Constants:**
- `MAX_TURNS_BY_COMPLEXITY` - 10/20/35 for simple/medium/complex
- `CHECKPOINT_INTERVAL` - Every 5 turns
- `MODEL_TIERS` - Model capability hierarchy

## Usage Example

```typescript
import { executeAgenticLoop } from './modules/agentic/loop';
import { getModelForAgent, getMaxTurns } from './templates/registry';

const result = await executeAgenticLoop(
  {
    maxTurns: getMaxTurns('medium', 20),
    currentTurn: 0,
    model: getModelForAgent('python-coder'),
    agentRole: 'python-coder',
    tools: await getTools(),
    checkpointInterval: 5,
  },
  'Refactor the authentication module',
  threadId
);

if (result.success) {
  console.log('Task completed!');
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

## Safety Features

1. Max turn limits prevent infinite loops
2. Abort flags allow user to stop execution anytime
3. Confidence monitoring detects when stuck
4. Model escalation automatically upgrades when struggling
5. Checkpointing saves progress regularly
6. Error tracking detects repeated failures
7. User clarification asks for help when truly stuck

## See Also

- [Adding Models Guide](../../../../docs/ADDING-MODELS.md)
- [Handler Documentation](../../handlers/README.md)
