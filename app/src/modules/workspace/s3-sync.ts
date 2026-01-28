import { workspaceManager } from './manager';
import { createLogger } from '../../utils/logger';

const log = createLogger('WORKSPACE:S3_SYNC');

export class S3Sync {
    private bucketName: string;

    constructor() {
        this.bucketName = process.env.S3_ARTIFACT_BUCKET || 'discord-bot-artifacts';
    }

    async syncToS3(threadId: string): Promise<void> {
        const workspacePath = `/workspace/${threadId}`;
        const s3Path = `s3://${this.bucketName}/threads/${threadId}/`;

        log.info(`Syncing workspace to S3: ${workspacePath} -> ${s3Path}`);

        try {
            await workspaceManager.runCommand(threadId, [
                'aws', 's3', 'sync',
                workspacePath,
                s3Path,
                '--delete'
            ]);
            log.info(`Sync to S3 completed for thread: ${threadId}`);
        } catch (err) {
            log.error(`Failed to sync to S3 for thread: ${threadId}`, { error: String(err) });
            throw err;
        }
    }

    async syncFromS3(threadId: string): Promise<void> {
        const workspacePath = `/workspace/${threadId}`;
        const s3Path = `s3://${this.bucketName}/threads/${threadId}/`;

        log.info(`Syncing from S3 to workspace: ${s3Path} -> ${workspacePath}`);

        await workspaceManager.ensureWorkspace(threadId);

        try {
            await workspaceManager.runCommand(threadId, [
                'aws', 's3', 'sync',
                s3Path,
                workspacePath
            ]);
            log.info(`Sync from S3 completed for thread: ${threadId}`);
        } catch (err) {
            log.warn(`Failed to sync from S3 for thread: ${threadId} (might be new thread)`, { error: String(err) });
        }
    }

    async deletePrefix(threadId: string): Promise<void> {
        const s3Path = `s3://${this.bucketName}/threads/${threadId}/`;
        log.info(`Deleting S3 prefix: ${s3Path}`);

        try {
            await workspaceManager.runCommand(threadId, [
                'aws', 's3', 'rm',
                s3Path,
                '--recursive'
            ]);
        } catch (err) {
            log.error(`Failed to delete S3 prefix for thread: ${threadId}`, { error: String(err) });
        }
    }
}

export const s3Sync = new S3Sync();
