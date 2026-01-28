import * as k8s from '@kubernetes/client-node';
import { createLogger } from '../../utils/logger';
import * as stream from 'node:stream';

const log = createLogger('WORKSPACE:MANAGER');

export class WorkspaceManager {
    private kc: k8s.KubeConfig;
    private k8sApi: k8s.CoreV1Api;
    private exec: k8s.Exec;
    private namespace = 'discord-bot';
    private sandboxLabel = 'app=dev-sandbox';

    constructor() {
        this.kc = new k8s.KubeConfig();
        this.kc.loadFromDefault();
        this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
        this.exec = new k8s.Exec(this.kc);
    }

    private async getSandboxPod(): Promise<string> {
        const res = await this.k8sApi.listNamespacedPod(
            this.namespace,
            undefined,
            undefined,
            undefined,
            undefined,
            this.sandboxLabel
        );

        const pods = res.body.items;
        if (pods.length === 0) {
            throw new Error('No dev-sandbox pod found');
        }

        const podName = pods[0].metadata?.name;
        if (!podName) {
            throw new Error('Sandbox pod has no name');
        }

        return podName;
    }

    async ensureWorkspace(threadId: string): Promise<string> {
        const path = `/workspace/${threadId}`;
        log.info(`Ensuring workspace: ${path}`);

        await this.runCommand(threadId, ['mkdir', '-p', path]);
        return path;
    }

    async writeFile(threadId: string, filePath: string, content: string | Buffer): Promise<void> {
        const workspacePath = `/workspace/${threadId}`;
        const fullPath = `${workspacePath}/${filePath}`;
        const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

        log.info(`Writing file: ${fullPath}`);

        if (dir !== workspacePath) {
            await this.runCommand(threadId, ['mkdir', '-p', dir]);
        }

        // Use base64 to avoid issues with special characters in shell
        const base64Content = Buffer.from(content).toString('base64');
        await this.runCommand(threadId, [
            'sh',
            '-c',
            `echo "${base64Content}" | base64 -d > "${fullPath}"`
        ]);
    }

    async readFile(threadId: string, filePath: string): Promise<Buffer> {
        const fullPath = `/workspace/${threadId}/${filePath}`;
        log.info(`Reading file: ${fullPath}`);

        const result = await this.runCommand(threadId, ['cat', fullPath], true);
        return Buffer.from(result);
    }

    async listFiles(threadId: string): Promise<string[]> {
        const path = `/workspace/${threadId}`;
        log.info(`Listing files in: ${path}`);

        const result = await this.runCommand(threadId, ['find', '.', '-type', 'f'], false, path);
        return result.split('\n').map(f => f.trim()).filter(f => f && f !== '.');
    }

    async deleteWorkspace(threadId: string): Promise<void> {
        const path = `/workspace/${threadId}`;
        log.info(`Deleting workspace: ${path}`);
        await this.runCommand(threadId, ['rm', '-rf', path]);
    }

    async runCommand(
        threadId: string,
        command: string[],
        isBinary = false,
        cwd?: string
    ): Promise<string> {
        const podName = await this.getSandboxPod();

        const stdout = new stream.PassThrough();
        const stderr = new stream.PassThrough();

        const chunks: Buffer[] = [];
        stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

        const errChunks: Buffer[] = [];
        stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

        const finalCommand = cwd ? ['sh', '-c', `cd ${cwd} && ${command.join(' ')}`] : command;

        return new Promise((resolve, reject) => {
            this.exec.exec(
                this.namespace,
                podName,
                'mcp-shell',
                finalCommand,
                stdout,
                stderr,
                null,
                false,
                (status: k8s.V1Status) => {
                    if (status.status === 'Success') {
                        const output = Buffer.concat(chunks);
                        resolve(isBinary ? output as any : output.toString('utf8'));
                    } else {
                        const error = Buffer.concat(errChunks).toString('utf8');
                        log.error(`Command failed: ${finalCommand.join(' ')}`, { status: status.status, error });
                        reject(new Error(`Command failed with status ${status.status}: ${error}`));
                    }
                }
            ).catch(reject);
        });
    }
}

export const workspaceManager = new WorkspaceManager();
