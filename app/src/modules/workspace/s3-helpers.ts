import { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectsCommand, ListObjectsV2Output, _Object } from '@aws-sdk/client-s3';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';

const log = createLogger('WORKSPACE:S3_HELPERS');

let s3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3Client) {
    const config = getConfig();
    s3Client = new S3Client({
      region: config.AWS_REGION,
    });
    log.info(`S3 client initialized for region: ${config.AWS_REGION}`);
  }
  return s3Client;
}

export function getBucketName(): string {
  const config = getConfig();
  return config.S3_ARTIFACT_BUCKET;
}

export interface S3FileInfo {
  key: string;
  size: number;
  lastModified: Date;
  relativePath: string;
}

/**
 * List files in S3 for a given thread prefix
 */
export async function listS3Files(
  threadId: string,
  prefix?: string
): Promise<S3FileInfo[]> {
  const s3 = getS3Client();
  const bucket = getBucketName();
  const fullPrefix = prefix
    ? `threads/${threadId}/${prefix}`
    : `threads/${threadId}/`;

  log.info(`Listing S3 files: ${bucket}/${fullPrefix}`);

  const files: S3FileInfo[] = [];
  let continuationToken: string | undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      });

      const response: ListObjectsV2Output = await s3.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && obj.Key !== fullPrefix) {
            files.push({
              key: obj.Key,
              size: obj.Size || 0,
              lastModified: obj.LastModified || new Date(),
              relativePath: obj.Key.replace(`threads/${threadId}/`, ''),
            });
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    log.info(`Found ${files.length} files in S3 for thread ${threadId}`);
    return files;
  } catch (error) {
    log.error(`Failed to list S3 files for thread ${threadId}`, { error: String(error) });
    throw error;
  }
}

/**
 * Get a file from S3 as a buffer
 */
export async function getS3File(
  threadId: string,
  filePath: string
): Promise<Buffer> {
  const s3 = getS3Client();
  const bucket = getBucketName();
  const key = `threads/${threadId}/${filePath}`;

  log.info(`Getting S3 file: ${bucket}/${key}`);

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const response = await s3.send(command);

    if (!response.Body) {
      throw new Error(`Empty response body for ${key}`);
    }

    const chunks: Uint8Array[] = [];
    const stream = response.Body as NodeJS.ReadableStream;

    for await (const chunk of stream) {
      chunks.push(chunk as Uint8Array);
    }

    const buffer = Buffer.concat(chunks);
    log.info(`Retrieved ${buffer.length} bytes from S3: ${key}`);
    return buffer;
  } catch (error) {
    log.error(`Failed to get S3 file ${key}`, { error: String(error) });
    throw error;
  }
}

/**
 * Check if a file exists in S3
 */
export async function s3FileExists(
  threadId: string,
  filePath: string
): Promise<boolean> {
  try {
    await getS3File(threadId, filePath);
    return true;
  } catch (error) {
    if (String(error).includes('NoSuchKey') || String(error).includes('404')) {
      return false;
    }
    throw error;
  }
}

/**
 * Delete all files for a thread from S3
 */
export async function deleteS3Prefix(threadId: string): Promise<number> {
  const s3 = getS3Client();
  const bucket = getBucketName();
  const prefix = `threads/${threadId}/`;

  log.info(`Deleting S3 prefix: ${bucket}/${prefix}`);

  try {
    // First, list all objects
    const files = await listS3Files(threadId);

    if (files.length === 0) {
      log.info(`No files to delete in S3 for thread ${threadId}`);
      return 0;
    }

    // Delete objects in batches of 1000
    const keys = files.map(f => ({ Key: f.key }));
    const command = new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: keys,
        Quiet: true,
      },
    });

    await s3.send(command);
    log.info(`Deleted ${files.length} files from S3 for thread ${threadId}`);
    return files.length;
  } catch (error) {
    log.error(`Failed to delete S3 prefix for thread ${threadId}`, { error: String(error) });
    throw error;
  }
}

/**
 * Format file list as a tree structure
 */
export function formatFileTree(files: S3FileInfo[]): string {
  if (files.length === 0) {
    return '📂 *Empty workspace*';
  }

  const lines: string[] = [];
  const tree: Record<string, any> = {};

  // Build tree structure
  for (const file of files) {
    const parts = file.relativePath.split('/');
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (i === parts.length - 1) {
        current[part] = { __file: true, size: file.size };
      } else {
        current[part] = current[part] || {};
        current = current[part];
      }
    }
  }

  // Format tree
  function formatNode(node: Record<string, any>, prefix = ''): void {
    const entries = Object.entries(node);
    entries.sort((a, b) => {
      const aIsFile = !!a[1].__file;
      const bIsFile = !!b[1].__file;
      if (aIsFile !== bIsFile) return aIsFile ? 1 : -1;
      return a[0].localeCompare(b[0]);
    });

    for (let i = 0; i < entries.length; i++) {
      const [name, value] = entries[i];
      const isLast = i === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      if (value.__file) {
        const size = formatFileSize(value.size);
        lines.push(`${prefix}${connector}📄 ${name} (${size})`);
      } else {
        lines.push(`${prefix}${connector}📁 ${name}/`);
        formatNode(value, prefix + childPrefix);
      }
    }
  }

  formatNode(tree);
  return lines.join('\n');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}
