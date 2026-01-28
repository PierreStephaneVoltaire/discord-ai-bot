# Workspace Module

Per-thread workspace management with S3 persistence and file marker parsing for Discord.

## Overview

Manages isolated workspaces for each Discord thread, syncing files to/from S3 and parsing model responses for file attachments.

## Components

### Workspace Manager (`manager.ts`)

Central orchestrator for workspace operations:

**Core Functions:**
- `initializeWorkspace(threadId)` - Creates workspace directory, syncs from S3
- `cleanupWorkspace(threadId)` - Syncs to S3, deletes local workspace
- `readFile(threadId, filePath)` - Reads file from workspace
- `writeFile(threadId, filePath, content)` - Writes file to workspace
- `listFiles(threadId)` - Lists all files in workspace
- `syncToS3(threadId)` - Uploads workspace to S3
- `syncFromS3(threadId)` - Downloads workspace from S3

**Workspace Structure:**
```
/workspace/
  ├── <thread-id-1>/
  │   ├── src/
  │   ├── tests/
  │   └── ...
  ├── <thread-id-2>/
  │   └── ...
```

**S3 Structure:**
```
s3://discord-bot-artifacts/
  └── threads/
      ├── <thread-id-1>/
      │   ├── src/
      │   └── ...
      ├── <thread-id-2>/
      │   └── ...
```

### S3 Sync (`s3-sync.ts`)

Low-level S3 operations using AWS CLI:

**Key Functions:**
- `uploadToS3(localPath, s3Prefix)` - Syncs directory to S3
- `downloadFromS3(s3Prefix, localPath)` - Syncs S3 to local directory
- `deleteFromS3(s3Prefix)` - Deletes S3 prefix (cleanup)

**Uses AWS CLI:**
```bash
aws s3 sync /workspace/<thread-id>/ s3://bucket/threads/<thread-id>/ --region=us-east-1
aws s3 sync s3://bucket/threads/<thread-id>/ /workspace/<thread-id>/ --region=us-east-1
aws s3 rm s3://bucket/threads/<thread-id>/ --recursive
```

**Why CLI over SDK:**
- Simpler implementation
- Better handling of directory structures
- Automatic retry logic built-in
- Progress indicators available

### File Sync (`file-sync.ts`)

Handles Discord attachment downloads and uploads:

**Inbound (User → Workspace):**
```typescript
await downloadAttachments(threadId, message.attachments);
// Downloads from Discord URLs → /workspace/<thread-id>/
```

**Outbound (Workspace → Discord):**
```typescript
await uploadFileToDiscord(threadId, 'src/index.ts', channelId);
// Reads from workspace → Sends as Discord attachment
```

**Key Functions:**
- `downloadAttachments(threadId, attachments)` - Save Discord files to workspace
- `uploadFileToDiscord(threadId, filePath, channelId)` - Send file as Discord attachment
- `getFileExtension(filename)` - Extract extension for validation

### Response Parser (`response-parser.ts`)

Extracts file markers from model responses:

**Marker Format:** `<<relative/path/to/file>>`

**Example Input:**
```
Here's the implementation:

<<src/api/auth.ts>>

And the configuration:

<<config/auth.config.ts>>

All tests pass!
```

**Parsed Output:**
```typescript
[
  { type: 'text', content: "Here's the implementation:\n\n" },
  { type: 'file', content: 'src/api/auth.ts', filePath: 'src/api/auth.ts' },
  { type: 'text', content: "\n\nAnd the configuration:\n\n" },
  { type: 'file', content: 'config/auth.config.ts', filePath: 'config/auth.config.ts' },
  { type: 'text', content: "\n\nAll tests pass!" }
]
```

**Key Function:**
- `parseResponse(response)` - Splits response into text/file parts

**Regex:** `/<<([^>]+)>>/g`

## Workflow

### 1. Thread Created

```typescript
// Automatically called when execution starts
await workspaceManager.initializeWorkspace(threadId);
// → Creates /workspace/<thread-id>/
// → Syncs from S3 if previous state exists
// → Otherwise starts with empty workspace
```

### 2. User Uploads Attachments

```typescript
// Discord message handler
await downloadAttachments(threadId, message.attachments);
// → Saves files to /workspace/<thread-id>/
// → Available immediately for model execution
```

### 3. Model Execution

```typescript
// Model has access to workspace via MCP tools
const result = await chatCompletion({
  messages: [
    {
      role: 'system',
      content: `You have access to workspace at /workspace/${threadId}. ` +
               `Files uploaded by user are already there.`
    },
    // ...
  ],
  tools: await getTools(threadId), // MCP filesystem tools
});

// Model can:
//  - list_files() → See what's in workspace
//  - read_file() → Read user's uploaded files
//  - write_file() → Create new files
//  - execute_command() → Run commands in workspace
```

### 4. Model Response with File Markers

```typescript
const modelResponse = `
I've implemented the authentication system:

<<src/auth/login.ts>>
<<src/auth/register.ts>>
<<tests/auth.test.ts>>

All tests pass! Run with \`npm test\`.
`;

// Parse response
const parts = parseResponse(modelResponse);
// → [text, file, file, file, text]
```

### 5. Send to Discord

```typescript
for (const part of parts) {
  if (part.type === 'text') {
    // Send text (auto-chunked if > 1900 chars)
    await sendMessage(channelId, part.content);
  } else if (part.type === 'file') {
    // Read from workspace and attach
    const content = await workspaceManager.readFile(threadId, part.filePath);
    await sendMessage(channelId, {
      content: `📎 **${part.content}**`,
      files: [{ name: part.content, data: content }]
    });
  }
}
```

### 6. Execution Complete

```typescript
// Automatically called after execution
await workspaceManager.syncToS3(threadId);
// → Uploads /workspace/<thread-id>/ to S3
// → Preserves state for next execution
```

### 7. Thread Cleanup (Optional)

```typescript
// Called when thread is deleted or after long inactivity
await workspaceManager.cleanupWorkspace(threadId);
// → Syncs to S3 one final time
// → Deletes /workspace/<thread-id>/
// → S3 data remains for history
```

## Error Handling

### File Not Found

```typescript
try {
  const content = await workspaceManager.readFile(threadId, 'missing.txt');
} catch (err) {
  // Sends Discord message:
  // ⚠️ *Could not attach file `missing.txt`. It may not have been created or saved properly.*
}
```

### S3 Sync Failures

```typescript
try {
  await workspaceManager.syncToS3(threadId);
} catch (err) {
  log.error(`S3 sync failed: ${err.message}`);
  // Continues execution - local files still available
  // Retry on next sync or manual intervention
}
```

### Rate Limiting

```typescript
// 1.5 second delay between Discord messages
for (let i = 0; i < parts.length; i++) {
  await sendPart(parts[i]);
  if (i < parts.length - 1) {
    await sleep(1500);
  }
}
```

## Configuration

**Environment Variables:**
- `S3_ARTIFACT_BUCKET` - S3 bucket name for artifacts
- `AWS_REGION` - AWS region (default: us-east-1)

**Directory Structure:**
- Local: `/workspace/<thread-id>/`
- S3: `s3://${S3_ARTIFACT_BUCKET}/threads/<thread-id>/`

## Performance

**Initialization:**
- Empty workspace: ~100ms (mkdir only)
- Existing S3 state: ~500ms-2s (depends on file count)

**File Operations:**
- Read/Write: ~1-5ms (local filesystem)
- S3 Sync: ~500ms-5s (depends on file count)

**Response Parsing:**
- ~1-2ms per response (regex matching)

## Security

**Isolation:**
- Each thread gets its own workspace directory
- No cross-thread file access
- S3 prefixes prevent collision

**Validation:**
- File paths checked for directory traversal (`../`)
- Extensions validated for allowed types
- Content length limits on Discord uploads (8MB)

**Cleanup:**
- Local workspaces deleted after execution
- S3 data can have TTL policy for auto-expiration
- No sensitive data persisted beyond session

## Example: Full Flow

**User:** "Create a REST API for user authentication"

**System:**
1. Initialize workspace: `/workspace/123456/`
2. Model writes files:
   - `src/auth.ts`
   - `src/routes.ts`
   - `tests/auth.test.ts`
3. Model responds:
   ```
   I've created the auth API:
   
   <<src/auth.ts>>
   <<src/routes.ts>>
   <<tests/auth.test.ts>>
   
   Run `npm test` to verify.
   ```
4. System parses response → 5 parts (text, file, file, file, text)
5. Discord output:
   - Message: "I've created the auth API:"
   - Attachment: 📎 **src/auth.ts**
   - Attachment: 📎 **src/routes.ts**
   - Attachment: 📎 **tests/auth.test.ts**
   - Message: "Run `npm test` to verify."
6. Sync to S3: `s3://bucket/threads/123456/src/auth.ts` (etc.)

**Next message in same thread:**
1. Workspace already exists, sync from S3
2. Model has access to previous files
3. Can modify, add, or delete files
4. Sync changes back to S3

## Integration

**Used By:**
- `/app/src/pipeline/response.ts` - Discord message formatting
- `/app/src/modules/agentic/loop.ts` - Execution loop
- `/app/src/pipeline/flows/sequential-thinking.ts` - Flow orchestration

**Depends On:**
- `discord` module - Sending messages/attachments
- AWS CLI - S3 operations
- MCP tools - File system access during execution

## See Also

- [Response Handler](../../pipeline/response.ts)
- [Agentic Loop](../agentic/loop.ts)
- [Discord Module](../discord/index.ts)
