import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';

const log = createLogger('DYNAMODB');

let docClient: DynamoDBDocumentClient | null = null;

export function getDynamoDBClient(): DynamoDBDocumentClient {
  if (!docClient) {
    log.info('Initializing DynamoDB client');
    const config = getConfig();

    const client = new DynamoDBClient({
      region: config.AWS_REGION,
    });

    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });

    log.info(`DynamoDB client initialized for region: ${config.AWS_REGION}`);
  }

  return docClient;
}

export * from './sessions';
export * from './executions';
export * from './types';
