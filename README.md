# Multi-Agent Agentic Discord Bot

An autonomous multi-agent Discord bot that can execute complex multi-turn tasks, self-correct, escalate when stuck, and interact with users through reactions and clarifications.

**Key Features:**
- 🤖 Multi-turn agentic execution with **Reflexion** learning pattern
- 🧠 **Chain-of-Thought** prompting for step-by-step reasoning
- 🗂️ Per-thread S3 artifact storage with automatic file sync
- 🎯 Specialized agent roles (Python coder, DevOps engineer, Architect, etc.)
- 📈 Automatic model escalation (Gemini → Sonnet → Opus)
- 🔄 **Self-reflection** and persistent learning from past attempts
- 🛑 Human-in-the-loop controls (stop, approve, reject via reactions)
- 👍👎 User feedback directly influences confidence scores
- 📊 Full observability (DynamoDB logs, SQS events, Discord progress)
- 🔒 Thread-safe execution with abort flags
- ⚡ Intelligent task classification and routing

## Architecture

### Execution Flows

The bot supports 4 execution flows based on task classification:

```
User Message
    ↓
[Opus] Should respond? → YES/NO
    ↓
[Opus] Classify task → TaskType + AgentRole + Complexity
    ↓
    ├─→ SIMPLE (social, general chat)
    │   └─→ Single turn, no tools, no planning
    │
    ├─→ BRANCH (multi-solution brainstorming)
    │   └─→ Multiple models explore different architectural approaches
    │   └─→ Theoretical only, no code generation
    │
    ├─→ SEQUENTIAL-THINKING (complex multi-turn with Reflexion)
    │   └─→ Chain-of-Thought execution with self-reflection
    │   └─→ Per-thread artifact storage in S3
    │   └─→ Evaluator scores trajectory → Opus reflects
    │
    └─→ BREAKGLASS (emergency override)
        └─→ Direct Opus access, bypasses all checks
```

### Reflexion Learning Pattern

The sequential-thinking flow implements the **Reflexion** pattern for continuous improvement:

```
1. Load Session (reflections + key insights from DynamoDB)
   ↓
2. Opus Plans (informed by previous trajectory + evaluation)
   ↓
3. Actor Executes (Chain-of-Thought prompting)
   ↓
4. Evaluator Scores Trajectory (task completion, code quality, efficiency)
   ↓
5. Opus Self-Reflects (what worked, what failed, strategy change)
   ↓
6. Save to Memory (sliding window: last 5 reflections, top 20 insights)
   ↓
7. Next execution benefits from learnings
```

**Memory Components:**
- **Reflections**: Last 5 execution reflections (sliding window in DynamoDB)
- **Key Insights**: Top 20 persistent learnings across all executions
- **Trajectory Summary**: Compressed history of previous attempt
- **Evaluation Scores**: Task completion, code quality, efficiency metrics

### Agentic Execution Loop

```
1. Create execution lock (prevents concurrent runs)
2. Post "Starting work..." message (users can react 🛑 to abort)
3. FOR each turn (up to maxTurns):
   a. Check abort flag
   b. Execute turn with LLM + MCP tools
   c. Stream progress to Discord
   d. Update confidence score
   e. Check escalation triggers
   f. Checkpoint every 5 turns
   g. If complete → finalize
   h. If stuck → escalate or ask user
4. Release lock
5. Post commit message with 👍/👎 reactions
```

### Control Mechanisms

| Mechanism | Trigger | Action |
|-----------|---------|--------|
| 🛑 Reaction | On "Starting work..." message | Set abort flag, halt at next turn |
| 👍 Reaction | On commit message | Merge branch to main |
| 👎 Reaction | On commit message | Delete branch, reject changes |
| Low confidence | Confidence < 30% for 2 turns | Escalate model |
| Repeated errors | Same error 3 times | Escalate model |
| No progress | No file changes for 5 turns | Escalate model |
| Max escalation | Already at Opus, still stuck | Ask user for clarification |

### Model Tiers

| Tier | Models | Tool Support | Use Case | Cost |
|------|--------|--------------|----------|------|
| 1 | mistral-nemo, gpt-oss-120b:exacto, general, gemini-2.5-flash-lite | ❌ No | Social, writing | $ (0.02-0.10) |
| 2 | minimax-m2.1, gpt-5.1-codex-mini, gemini-3-flash, glm-4.7 | ✅ Yes | Coding, Q&A | $$ (0.25-0.54) |
| 3 | qwen3-coder-plus, gpt-5.1-codex-max, gemini-3-pro, claude-sonnet-4.5 | ✅ Yes | Complex code, reviews | $$$ (1.00-3.00) |
| 4 | qwen3-max, gpt-5.2-codex, claude-sonnet-4.5, claude-opus-4.5 | ✅ Yes | Critical decisions | $$$$ (1.20-5.00) |

**Escalation Path:**
```
mistral-nemo → minimax-m2.1 → qwen3-coder-plus → claude-sonnet-4.5 → claude-opus-4.5
```

### Agent Roles

| Role | Tier | Template | Model | Use Case |
|------|------|----------|-------|----------|
| Command Executor | 2 | command-executor | [2] gemini-3-flash | Fast bash/kubectl commands |
| Python Coder | 2 | python-coder | [1] gpt-5.1-codex-mini | Python development |
| JS/TS Coder | 2 | js-ts-coder | [0] minimax-m2.1 | JavaScript/TypeScript |
| DevOps Engineer | 3 | devops-engineer | [3] claude-sonnet-4.5 | Infrastructure, K8s |
| Architect | 4 | architect | [3] claude-opus-4.5 | System design |
| Code Reviewer | 3 | code-reviewer | [3] claude-sonnet-4.5 | Code quality (w/ Random Peer) |
| Documentation Writer | 3 | documentation-writer | [0] qwen3-coder-plus | Docs, README |
| DBA | 3 | dba | [2] gemini-3-pro | Database operations |
| Researcher | 2 | researcher | [1] gpt-5.1-codex-mini | Code search |

## Advanced Features

### 1. Reflexion Learning Pattern

The bot implements the **Reflexion** pattern, enabling it to learn from past attempts:

**Components:**
- **Actor**: Execution model with Chain-of-Thought prompting
- **Evaluator**: Heuristic-based trajectory scoring (task completion, code quality, efficiency)
- **Self-Reflection**: Opus analyzes what worked/failed and generates strategy changes
- **Memory**: DynamoDB stores reflections, key insights, and trajectory summaries

**How It Works:**
1. Before execution, Opus reviews previous reflections and evaluation scores
2. During execution, the Actor implements with step-by-step reasoning
3. After execution, the Evaluator scores the trajectory (0-100)
4. Opus generates a reflection: what worked, what failed, root cause, strategy change, key insight
5. Reflection is saved with sliding window (last 5) and key insights (top 20)
6. Next execution benefits from these learnings

### 2. Chain-of-Thought Prompting

All execution models are prompted to think step-by-step:

**Structure:**
```
1. Understand the Problem
2. Break Down into Steps
3. Consider Edge Cases
4. Explain Approach
5. Implement Step-by-Step
6. Verify Solution
```

This reduces errors and improves logic by forcing models to articulate their reasoning before acting.

### 3. Per-Thread S3 Artifact Storage

Each Discord thread gets its own isolated workspace:

**Architecture:**
- **Workspace**: `/workspace/<thread-id>/` in Kubernetes pod
- **S3 Sync**: `s3://discord-bot-artifacts/threads/<thread-id>/`
- **Discord Attachments**: Auto-synced to workspace before execution
- **Model Outputs**: Use `<<filename>>` markers to send files back to Discord

**Workflow:**
1. User uploads attachment → Auto-synced to workspace
2. Model reads/writes files in workspace
3. Model includes `<<src/index.ts>>` in response
4. System reads file from workspace → Sends as Discord attachment
5. After execution → Workspace synced to S3
6. Thread deleted → Workspace + S3 prefix cleaned up

### 4. User Feedback Integration

Users directly influence the bot's confidence through reactions:

- **👍 on bot message**: +15 confidence (encourages similar approach)
- **👎 on bot message**: -20 confidence (triggers reflection/escalation)
- Confidence clamped 10-100 and persisted across messages

This creates a feedback loop where user satisfaction directly impacts the bot's decision-making.

### 5. Branch Flow (Multi-Solution Brainstorming)

Trigger with phrases like "different approaches", "pros and cons", "explore options":

**Process:**
1. Two models brainstorm in parallel
2. Consolidator merges unique approaches
3. Presents 2-3 architectural options with pros/cons
4. **No code generation** - purely theoretical/architectural

**Triggers:**
- "multiple solutions", "brainstorm", "different ways"
- "compare approaches", "tradeoffs", "which approach"

## Project Structure

```
app/
├── src/
│   ├── modules/
│   │   ├── agentic/          # Multi-turn execution system
│   │   │   ├── loop.ts       # Main execution loop with CoT
│   │   │   ├── lock.ts       # Thread-safe locks
│   │   │   ├── escalation.ts # Model escalation
│   │   │   ├── progress.ts   # Discord progress streaming
│   │   │   ├── commits.ts    # Git operations
│   │   │   ├── logging.ts    # DynamoDB logging
│   │   │   ├── events.ts     # SQS event emission
│   │   │   └── README.md     # Module documentation
│   │   ├── reflexion/        # Reflexion learning pattern
│   │   │   ├── evaluator.ts  # Trajectory evaluation
│   │   │   ├── memory.ts     # Reflection management
│   │   │   └── types.ts      # Reflexion interfaces
│   │   ├── workspace/        # Per-thread S3 artifact storage
│   │   │   ├── manager.ts    # Workspace operations
│   │   │   ├── s3-sync.ts    # S3 synchronization
│   │   │   └── file-sync.ts  # Discord attachment sync
│   │   ├── discord/          # Discord client with partials
│   │   ├── litellm/          # LLM integration
│   │   └── dynamodb/         # Database operations
│   ├── handlers/
│   │   ├── reactions.ts      # Emoji reaction handler
│   │   ├── feedback.ts       # User feedback (👍👎)
│   │   ├── debounce.ts       # Message debouncing
│   │   └── README.md         # Handler documentation
│   ├── pipeline/             # Message processing pipeline
│   │   └── flows/
│   │       ├── sequential-thinking.ts  # Reflexion flow
│   │       ├── branch.ts               # Multi-solution brainstorming
│   │       ├── simple.ts               # Quick responses
│   │       └── breakglass.ts           # Emergency override
│   ├── templates/            # Prompt templates with CoT
│   │   ├── planning.txt      # Opus planning with reflection
│   │   └── prompts/
│   │       ├── coding.txt    # CoT for implementation
│   │       ├── devops.txt
│   │       ├── architect.txt
│   │       └── ...
│   └── index.ts              # Application entry point
└── package.json

terraform/
├── dynamodb.tf               # Sessions + Executions tables (with Reflexion fields)
├── s3.tf                     # Artifact storage bucket
├── sqs.tf                    # Message + Event queues
├── kubernetes.tf             # K8s deployments
├── main.tf                   # Provider config
└── README.md                 # Infrastructure docs

docs/
└── ADDING-MODELS.md         # Guide for adding new models
```

## Quick Start

### Prerequisites

- Node.js 20+
- Discord bot token
- LiteLLM proxy running
- AWS account (for DynamoDB + SQS)
- Kubernetes cluster (optional, for deployment)

### Local Development

1. **Install dependencies:**
```bash
cd app
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
```

Required environment variables:
```bash
DISCORD_TOKEN=your_discord_bot_token
LITELLM_API_KEY=your_litellm_key
LITELLM_BASE_URL=http://localhost:4000
AWS_REGION=ca-central-1
DYNAMODB_SESSIONS_TABLE=discord_sessions
DYNAMODB_EXECUTIONS_TABLE=discord_executions
AGNETIC_EVENTS_QUEUE_URL=https://sqs.region.amazonaws.com/account/queue
S3_ARTIFACT_BUCKET=discord-bot-artifacts  # Per-thread artifact storage
PLANNER_MODEL_ID=kimi-k2.5                # Model for planning phase
```

3. **Run locally:**
```bash
npm run dev
```

### Deploy Infrastructure

1. **Create DynamoDB tables:**
```bash
cd terraform
terraform init
terraform apply -target=aws_dynamodb_table.discord_sessions
terraform apply -target=aws_dynamodb_table.discord_executions
terraform apply -target=aws_dynamodb_table.discord_messages
```

2. **Create SQS queues:**
```bash
terraform apply -target=aws_sqs_queue.agentic_events
terraform apply -target=aws_sqs_queue.discord_messages
```

3. **Deploy to Kubernetes:**
```bash
terraform apply
```

## Usage Examples

### Simple Q&A

```
User: @bot what is async/await in JavaScript?
Bot: [Responds with explanation, no code generation]
```

### Tool Execution

```
User: @bot run kubectl get pods
Bot: [Executes command, shows output]
```

### Code Implementation (Agentic)

```
User: @bot refactor the authentication module to use JWT
Bot: 🚀 Starting work... (react 🛑 to stop)
     🤔 Turn 1/20 | Confidence: 85% | Model: gemini
     📁 Reading: src/auth/index.ts
     ✏️ Writing: src/auth/jwt.ts
     ✅ Turn 1 complete | Confidence: 90% | Files: 2 modified
     
     [... more turns ...]
     
     📝 Commit: Refactor auth to use JWT
     Branch: `auth-jwt-refactor`
     Files: auth/index.ts, auth/jwt.ts, auth/middleware.ts
     👍 to merge | 👎 to reject
```

User reacts 👍 → Branch merged automatically

### Stopping Execution

```
Bot: 🚀 Starting work...
User: [Reacts with 🛑]
Bot: ⏹️ Execution stop requested. Will halt at next turn.
     [Stops at next turn, saves checkpoint]
```

## Debugging

### View Execution Logs

**DynamoDB:**
```bash
aws dynamodb query \
  --table-name discord-messages \
  --key-condition-expression "pk = :threadId" \
  --expression-attribute-values '{":threadId":{"S":"1234567890"}}'
```

**Application Logs:**
```bash
kubectl logs -f deployment/discord-bot -n discord-bot
```

### Consume Events

```bash
aws sqs receive-message \
  --queue-url $(terraform output -raw agentic_events_queue_url) \
  --max-number-of-messages 10
```

### Check Execution State

```typescript
import { getLock } from './modules/agentic/lock';

const lock = getLock(threadId);
console.log(lock);
```

### Monitor Progress

All progress updates are streamed to Discord in real-time:
- Turn start/complete
- Tool execution
- Checkpoints
- Escalations
- Clarification requests

## Configuration

### Model Selection

**By Agent Role:**
```typescript
// app/src/templates/registry.ts
export const AGENT_MODEL_TIER_MAP = {
  [AgentRole.PYTHON_CODER]: 'tier2',
};

export const AGENT_MODEL_INDEX_MAP = {
  [AgentRole.PYTHON_CODER]: 1,  // Use 2nd model in tier2
};
```

**By Task Type:**
```typescript
export const TASK_TYPE_TO_TIER_INDEX = {
  [TaskType.SOCIAL]: { tier: 'tier1', index: 0 },
  [TaskType.WRITING]: { tier: 'tier3', index: 1 },
};
```

### Escalation Thresholds

Triggers in `app/src/modules/agentic/escalation.ts`:
- Confidence < 30% for 2 consecutive turns
- Same error repeats 3 times
- No file changes for 5 turns
- Model reports 'stuck' status

### Max Turns

```typescript
// app/src/templates/registry.ts
export const MAX_TURNS_BY_COMPLEXITY = {
  [TaskComplexity.SIMPLE]: 10,
  [TaskComplexity.MEDIUM]: 20,
  [TaskComplexity.COMPLEX]: 35,
};
```

## Adding New Models

See [docs/ADDING-MODELS.md](docs/ADDING-MODELS.md) for detailed guide.

**Quick example:**
```typescript
// 1. Add to tier
export const MODEL_TIERS = {
  tier2: ['gemini-3-pro', 'gpt-4o-mini', 'claude-haiku'],
};

// 2. Assign to agent (optional)
export const AGENT_MODEL_INDEX_MAP = {
  [AgentRole.RESEARCHER]: 2,  // Use claude-haiku
};
```

## Safety Features

1. **Max turn limits** - Prevents infinite loops (10-35 turns)
2. **Abort flags** - User can stop anytime with 🛑
3. **Confidence monitoring** - Detects when stuck (< 30%)
4. **Model escalation** - Automatically upgrades when struggling
5. **Checkpointing** - Saves progress every 5 turns
6. **Error tracking** - Detects repeated failures (3x same error)
7. **User clarification** - Asks for help when truly stuck
8. **Thread isolation** - Each thread has independent lock
9. **Event logging** - Full audit trail in DynamoDB
10. **Progress streaming** - Real-time visibility in Discord

## Module Documentation

- [Agentic Module](app/src/modules/agentic/README.md) - Multi-turn execution
- [Handlers Module](app/src/handlers/README.md) - Reaction & debounce handlers
- [Infrastructure](terraform/README.md) - Terraform configuration
- [Adding Models Guide](docs/ADDING-MODELS.md) - How to add new LLM models

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Submit pull request

## License

MIT
