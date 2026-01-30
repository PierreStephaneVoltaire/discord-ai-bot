# Discord Slash Commands

This module implements slash commands for the multi-agent Discord bot, providing users with visibility and control over bot execution state, workspace management, and execution history.

## Available Commands

### `/status`
Shows the current execution state for the thread.

**Response includes:**
- 🔒 Lock Status (locked/unlocked with current turn)
- 🛑 Abort Flag status
- 🤖 Active Agent Role
- 🎯 Confidence Score
- 📁 Workspace Path
- ⬆️ Last Escalation (if any)
- 💾 Checkpoint Status

**Example:**
```
/status
```

---

### `/workspace list [thread_name]`
Lists files in the S3 workspace for the current or specified thread.

**Parameters:**
- `thread_name` (optional): List files from a specific thread

**Response:**
- Tree-formatted file list with sizes
- File count summary

**Examples:**
```
/workspace list
/workspace list my-thread-name
```

---

### `/workspace sync`
Forces an S3 sync for the current thread workspace.

**Behavior:**
- Syncs local `/workspace/<thread-id>/` to S3
- Checks for active execution lock before syncing
- Shows success/failure message

**Example:**
```
/workspace sync
```

---

### `/workspace clean`
Deletes all files in the current thread workspace (Admin only).

**Permissions:**
- Requires Discord Administrator permission or server ownership

**Behavior:**
- Deletes local workspace directory
- Deletes S3 prefix for the thread
- Cannot be used while execution is in progress

**Example:**
```
/workspace clean
```

---

### `/workspace upload <file_path>`
Uploads a specific file from S3 workspace to Discord.

**Parameters:**
- `file_path` (required): Relative path to file (e.g., `src/index.ts`)

**Behavior:**
- Fetches file from S3
- Uploads as Discord attachment
- Shows file size in response

**Example:**
```
/workspace upload src/index.ts
/workspace upload README.md
```

---

### `/flow <type>`
Forces a specific execution flow for the next task.

**Parameters:**
- `type` (required): One of:
  - `sequential-thinking` - Multi-turn with Reflexion
  - `branch` - Multi-solution brainstorming
  - `simple` - Single-turn response
  - `breakglass` - Direct Opus access

**Behavior:**
- Sets flow override in session
- Persists until next execution completes
- Overrides automatic classification

**Examples:**
```
/flow sequential-thinking
/flow breakglass
```

---

### `/logs [count]`
Shows recent execution logs from DynamoDB.

**Parameters:**
- `count` (optional): Number of logs to show (default: 5, max: 20)

**Response includes:**
- Task summary
- Final model used
- Turn count
- Outcome (success/failed/aborted)
- Confidence score

**Examples:**
```
/logs
/logs count:10
```

---

### `/confidence`
Shows current and historical confidence scores.

**Response includes:**
- Current confidence score
- Confidence level (High/Moderate/Low/Critical)
- Trend (Improving/Declining/Stable)
- History of last 10 scores
- Confidence-triggered escalations

**Example:**
```
/confidence
```

---

### `/escalation`
Shows escalation history for the thread.

**Response includes:**
- From/To model for each escalation
- Reason for escalation
- Turn number when it occurred
- Timestamp

**Example:**
```
/escalation
```

## Technical Details

### Command Registration
Commands are registered automatically when the bot starts:
- If `DISCORD_GUILD_ID` is set, commands are registered to that guild (faster updates)
- Otherwise, commands are registered globally (takes up to 1 hour to propagate)

### Permissions
- Most commands are available to all users
- `/workspace clean` requires Administrator permission
- All commands respect thread boundaries

### Error Handling
- Commands show user-friendly error messages
- Ephemeral messages are used for errors where appropriate
- Execution locks prevent destructive operations during active runs

### Data Sources
- **Session Data**: DynamoDB `discord_sessions` table
- **Execution Logs**: DynamoDB `discord_executions` table
- **Workspace Files**: S3 `discord-bot-artifacts/threads/<thread-id>/`
- **Lock Status**: In-memory Map

## Environment Variables

```env
DISCORD_TOKEN=your_bot_token
DISCORD_BOT_ID=your_bot_application_id
DISCORD_GUILD_ID=optional_test_guild_id
S3_ARTIFACT_BUCKET=discord-bot-artifacts
DYNAMODB_SESSIONS_TABLE=discord_sessions
DYNAMODB_EXECUTIONS_TABLE=discord_executions
AWS_REGION=ca-central-1
```

## Adding New Commands

1. Add command definition to `slashCommands` array in `slash-commands.ts`
2. Add handler function (e.g., `handleMyCommand`)
3. Add case to `handleSlashCommand` switch statement
4. Update this README

## File Structure

```
app/src/modules/discord/
├── slash-commands.ts          # Main command handlers
├── slash-commands-README.md   # This file
├── events.ts                  # Event handlers (includes command registration)
├── index.ts                   # Module exports
├── api.ts                     # Discord API helpers
└── types.ts                   # TypeScript types
```
