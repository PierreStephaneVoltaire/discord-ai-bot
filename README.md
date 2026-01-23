# Multi-Agent Agentic Discord Bot

An autonomous multi-agent Discord bot that can execute complex multi-turn tasks, self-correct, escalate when stuck, and interact with users through reactions and clarifications.

**Key Features:**
- 🤖 Multi-turn agentic execution (like Claude Code + Claude.ai)
- 🎯 Specialized agent roles (Python coder, DevOps engineer, Architect, etc.)
- 📈 Automatic model escalation (Gemini → Sonnet → Opus)
- 🛑 Human-in-the-loop controls (stop, approve, reject via reactions)
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
    ├─→ TECHNICAL_SIMPLE (Q&A, commands)
    │   └─→ Single turn with tools, no planning
    │
    ├─→ TECHNICAL (implementation with planning)
    │   └─→ Single turn with plan + tools
    │
    └─→ AGENTIC (complex multi-turn)
        └─→ Multi-turn loop with escalation
```

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
| 1 | gemini-2.5-flash-lite | ❌ No | Social, writing | $ |
| 2 | gemini, gpt-4o-mini | ✅ Yes | Coding, Q&A | $$ |
| 3 | sonnet, gpt-4o | ✅ Yes | Complex code, reviews | $$$ |
| 4 | opus, o1 | ✅ Yes | Critical decisions | $$$$ |

**Escalation Path:**
```
gemini-2.5-flash-lite → gemini → gpt-4o-mini → sonnet → gpt-4o → opus → o1
```

### Agent Roles

| Role | Tier | Template | Use Case |
|------|------|----------|----------|
| Command Executor | 2 | command-executor | Fast bash/kubectl commands |
| Python Coder | 2 | python-coder | Python development |
| JS/TS Coder | 2 | js-ts-coder | JavaScript/TypeScript |
| DevOps Engineer | 3 | devops-engineer | Infrastructure, K8s |
| Architect | 4 | architect | System design |
| Code Reviewer | 3 | code-reviewer | Code quality |
| Documentation Writer | 3 | documentation-writer | Docs, README |
| DBA | 3 | dba | Database operations |
| Researcher | 2 | researcher | Code search |

## Project Structure

```
app/
├── src/
│   ├── modules/
│   │   ├── agentic/          # Multi-turn execution system
│   │   │   ├── loop.ts       # Main execution loop
│   │   │   ├── lock.ts       # Thread-safe locks
│   │   │   ├── escalation.ts # Model escalation
│   │   │   ├── progress.ts   # Discord progress streaming
│   │   │   ├── commits.ts    # Git operations
│   │   │   ├── logging.ts    # DynamoDB logging
│   │   │   ├── events.ts     # SQS event emission
│   │   │   └── README.md     # Module documentation
│   │   ├── discord/          # Discord client
│   │   ├── litellm/          # LLM integration
│   │   └── dynamodb/         # Database operations
│   ├── handlers/
│   │   ├── reactions.ts      # Emoji reaction handler
│   │   ├── debounce.ts       # Message debouncing
│   │   └── README.md         # Handler documentation
│   ├── pipeline/             # Message processing pipeline
│   ├── templates/            # Prompt templates
│   │   └── registry.ts       # Model/template mapping
│   └── index.ts              # Application entry point
├── templates/                # Prompt template files
│   └── prompts/
│       ├── coding.txt
│       ├── devops.txt
│       ├── architect.txt
│       └── ...
└── package.json

terraform/
├── dynamodb.tf               # Sessions + Executions tables
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
AGENTIC_EVENTS_QUEUE_URL=https://sqs.region.amazonaws.com/account/queue
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
