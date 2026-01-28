import { Client } from 'discord.js';
import { getMessages } from '../discord/api';
import { workspaceManager } from './manager';
import { createLogger } from '../../utils/logger';
import { fetch } from 'undici';

const log = createLogger('WORKSPACE:FILE_SYNC');

export interface AttachmentInfo {
    filename: string;
    url: string;
    timestamp: string;
    messageId: string;
}

export interface SyncResult {
    synced: string[];      // All files currently in workspace
    added: string[];       // Newly added files in this sync
    updated: string[];     // Updated files (newer version)
}

export class DiscordFileSync {
    // Store known files to detect new ones
    // In a real app, this should probably be in DynamoDB
    private knownFiles: Map<string, Set<string>> = new Map(); // threadId -> Set of filenames

    async syncToWorkspace(
        client: Client,
        threadId: string,
        historyLimit: number = 100
    ): Promise<SyncResult> {
        log.info(`Syncing attachments for thread: ${threadId}`);

        // 1. Fetch history
        const messages = await getMessages(client, threadId, historyLimit);

        // 2. Extract and de-duplicate attachments (keep latest)
        const latestAttachments = new Map<string, AttachmentInfo>();

        // Sort messages by timestamp ascending
        const sortedMessages = [...messages].sort((a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );

        for (const msg of sortedMessages) {
            for (const att of msg.attachments) {
                latestAttachments.set(att.filename, {
                    filename: att.filename,
                    url: att.url,
                    timestamp: msg.timestamp,
                    messageId: msg.id
                });
            }
        }

        const result: SyncResult = {
            synced: [],
            added: [],
            updated: []
        };

        const threadKnownFiles = this.getKnownFiles(threadId);

        // 3. Download and write to workspace
        for (const [filename, info] of latestAttachments.entries()) {
            try {
                log.info(`Downloading: ${filename} from ${info.url}`);
                const response = await fetch(info.url);
                if (!response.ok) {
                    throw new Error(`Failed to download ${filename}: ${response.statusText}`);
                }

                const buffer = await response.arrayBuffer();
                await workspaceManager.writeFile(threadId, filename, Buffer.from(buffer));

                result.synced.push(filename);

                if (!threadKnownFiles.has(filename)) {
                    result.added.push(filename);
                    threadKnownFiles.add(filename);
                } else {
                    // Check if it's updated (different timestamp or internal logic)
                    // For simplicity, we just mark as synced if it was already known
                }
            } catch (err) {
                log.error(`Failed to sync file ${filename}`, { error: String(err) });
            }
        }

        return result;
    }

    private getKnownFiles(threadId: string): Set<string> {
        if (!this.knownFiles.has(threadId)) {
            this.knownFiles.set(threadId, new Set());
        }
        return this.knownFiles.get(threadId)!;
    }

    getNewFilesMessage(syncResult: SyncResult): string {
        if (syncResult.added.length === 0) return '';

        let msg = '\n\n## User Added Files\n';
        for (const file of syncResult.added) {
            msg += `- User added: ${file}\n`;
        }
        msg += '\nConsider reviewing these files if relevant to the task.\n';
        return msg;
    }
}

export const discordFileSync = new DiscordFileSync();
