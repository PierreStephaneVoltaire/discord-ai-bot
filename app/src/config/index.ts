import { createLogger } from '../utils/logger';

const log = createLogger('CONFIG');

export interface Config {
  DISCORD_TOKEN: string;
  DISCORD_BOT_ID: string;
  DISCORD_GUILD_ID: string;
  LITELLM_BASE_URL: string;
  LITELLM_API_KEY: string;
  AWS_REGION: string;
  DYNAMODB_SESSIONS_TABLE: string;
  DYNAMODB_EXECUTIONS_TABLE: string;
  S3_ARTIFACT_BUCKET: string;
  BOT_USERNAME: string;
  OTHER_BOT_USERNAME: string;
  STALENESS_MINUTES: number;
  PLANNER_MODEL_ID: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    log.error(`Missing required environment variable: ${name}`);
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export function loadConfig(): Config {
  log.info('Loading environment variables');

  const config: Config = {
    DISCORD_TOKEN: requireEnv('DISCORD_TOKEN'),
    DISCORD_BOT_ID: optionalEnv('DISCORD_BOT_ID', ''),
    DISCORD_GUILD_ID: optionalEnv('DISCORD_GUILD_ID', ''),
    LITELLM_BASE_URL: optionalEnv('LITELLM_BASE_URL', 'http://litellm:4000'),
    LITELLM_API_KEY: requireEnv('LITELLM_API_KEY'),
    AWS_REGION: optionalEnv('AWS_REGION', 'ca-central-1'),
    DYNAMODB_SESSIONS_TABLE: optionalEnv('DYNAMODB_SESSIONS_TABLE', 'discord_sessions'),
    DYNAMODB_EXECUTIONS_TABLE: optionalEnv('DYNAMODB_EXECUTIONS_TABLE', 'discord_executions'),
    S3_ARTIFACT_BUCKET: optionalEnv('S3_ARTIFACT_BUCKET', 'discord-bot-artifacts'),
    BOT_USERNAME: optionalEnv('BOT_USERNAME', 'nepnep'),
    OTHER_BOT_USERNAME: optionalEnv('OTHER_BOT_USERNAME', 'bot2'),
    STALENESS_MINUTES: parseInt(optionalEnv('STALENESS_MINUTES', '30'), 10),
    PLANNER_MODEL_ID: optionalEnv('PLANNER_MODEL_ID', 'kimi-k2.5'),
  };

  log.info(`DISCORD_TOKEN: ***masked***`);
  log.info(`DISCORD_BOT_ID: ${config.DISCORD_BOT_ID}`);
  log.info(`DISCORD_GUILD_ID: ${config.DISCORD_GUILD_ID}`);
  log.info(`LITELLM_BASE_URL: ${config.LITELLM_BASE_URL}`);
  log.info(`LITELLM_API_KEY: ***masked***`);
  log.info(`AWS_REGION: ${config.AWS_REGION}`);
  log.info(`DYNAMODB_SESSIONS_TABLE: ${config.DYNAMODB_SESSIONS_TABLE}`);
  log.info(`DYNAMODB_EXECUTIONS_TABLE: ${config.DYNAMODB_EXECUTIONS_TABLE}`);
  log.info(`S3_ARTIFACT_BUCKET: ${config.S3_ARTIFACT_BUCKET}`);
  log.info(`BOT_USERNAME: ${config.BOT_USERNAME}`);
  log.info(`OTHER_BOT_USERNAME: ${config.OTHER_BOT_USERNAME}`);
  log.info(`STALENESS_MINUTES: ${config.STALENESS_MINUTES}`);
  log.info(`PLANNER_MODEL_ID: ${config.PLANNER_MODEL_ID}`);
  log.info('Config loaded successfully');

  return config;
}

let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}
