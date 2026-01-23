# Handlers Module

Application-level event handlers with NO LLM involvement.

## Overview

Handlers are pure application code that respond to Discord events deterministically. They do NOT involve LLM calls - all logic is hardcoded and predictable.

## Components

### Reaction Handler (`reactions.ts`)

Handles emoji reactions on Discord messages.

**Supported Reactions:**

| Emoji | Message Type | Action |
|-------|-------------|--------|
| 👍 | Commit message | Merge branch to main |
| 👎 | Commit message | Delete branch |
| 🛑 | Execution start | Set abort flag |

**Key Functions:**
- `handleReactionAdd()` - Main reaction dispatcher
- `setupReactionHandlers()` - Register Discord event listeners

**Flow:**
```
1. Discord emits messageReactionAdd event
2. Check if user is bot (ignore if yes)
3. Identify message type (commit vs execution)
4. Execute appropriate action:
   - Commit + 👍 → mergeBranch()
   - Commit + 👎 → deleteBranch()
   - Execution + 🛑 → abortLock()
5. Emit event to SQS
6. Delete message (for commits)
```

**Message Type Detection:**
- Commit messages: Registered in `commitMessages` Map
- Execution messages: Check embed title/description

### Debounce Handler (`debounce.ts`)

Batches rapid messages to prevent spam processing.

**Purpose:**
- User sends: "do X" ... "and also Y" ... "use Python"
- Without debounce: 3 separate executions
- With debounce: 1 execution with all 3 messages

**Configuration:**
- Default: 10 seconds
- Configurable via `debounceMs` parameter

**Key Functions:**
- `debounceMessage()` - Add message to queue, reset timer
- `cancelDebounce()` - Cancel pending timer
- `getDebounceState()` - Check current state
- `clearAllDebounceTimers()` - Cleanup on shutdown

**Flow:**
```
1. Message arrives in channel
2. Check if debounce timer exists
3. If yes: Clear timer, add message to queue
4. If no: Create new queue with message
5. Start 10s timer
6. On timer expire: Process all queued messages
```

## Design Principles

### 1. Deterministic Behavior

Handlers execute the same action every time for the same input. No LLM interpretation.

**Good:**
```typescript
if (emoji === '👍') {
  await mergeBranch(branch);
}
```

**Bad:**
```typescript
const intent = await llm.classify(emoji);
if (intent === 'approve') {
  await mergeBranch(branch);
}
```

### 2. Fast Execution

Handlers should complete in < 100ms. No expensive operations.

### 3. Error Handling

Handlers catch and log errors but don't crash the bot.

```typescript
try {
  await mergeBranch(branch);
} catch (error) {
  log.error('Merge failed', error);
  await message.reply('❌ Merge failed');
}
```

### 4. Event Emission

Handlers emit events for observability but don't wait for them.

## Usage

### Setup Reaction Handlers

```typescript
import { setupReactionHandlers } from './handlers/reactions';
import { getDiscordClient } from './modules/discord';

const client = getDiscordClient();
setupReactionHandlers(client);
```

### Use Debouncing

```typescript
import { debounceMessage } from './handlers/debounce';

discord.on('messageCreate', async (message) => {
  await debounceMessage(
    message.channelId,
    message.id,
    10000
  );
  
  await processMessage(message);
});
```

## Testing

### Test Reactions

In Discord:
1. Bot posts commit message
2. React with 👍
3. Verify branch merged
4. Verify message deleted

### Test Debouncing

In Discord:
1. Send "do X"
2. Wait 5 seconds
3. Send "and Y"
4. Wait 5 seconds
5. Send "use Python"
6. Wait 10 seconds
7. Verify single execution with all 3 messages

## Debugging

**Check debounce state:**
```typescript
import { getDebounceState } from './handlers/debounce';

const state = getDebounceState(channelId);
console.log(state);
```

**Check reaction logs:**
```bash
kubectl logs -f deployment/discord-bot -n discord-bot | grep "HANDLERS:REACTIONS"
```

## Common Issues

### Reactions not working

**Symptoms:** Bot doesn't respond to 👍/👎/🛑

**Causes:**
1. Missing `GuildMessageReactions` intent
2. Commit message not registered
3. Bot user reacting (ignored)

**Fix:**
```typescript
const client = new Client({
  intents: [
    GatewayIntentBits.GuildMessageReactions,
  ],
});

registerCommitMessage(messageId, { branch, commitHash });
```

### Debounce not batching

**Symptoms:** Each message processed separately

**Causes:**
1. Timer too short
2. Messages in different channels
3. Timer cleared prematurely

**Fix:**
```typescript
await debounceMessage(channelId, messageId, 15000);
```

## See Also

- [Agentic Module](../modules/agentic/README.md)
- [Discord Module](../modules/discord/README.md)
