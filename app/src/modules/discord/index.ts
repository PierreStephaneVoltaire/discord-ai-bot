import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { getConfig } from '../../config/index';
import { createLogger } from '../../utils/logger';
import { setupEventHandlers, type MessageHandler } from './events';

const log = createLogger('DISCORD');

let clientInstance: Client | null = null;

export function createDiscordClient(): Client {
  log.info('Initializing gateway client');

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions, // Required for reaction handling
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
    ],
  });

  clientInstance = client;
  return client;
}

export function getDiscordClient(): Client {
  if (!clientInstance) {
    throw new Error('Discord client not initialized. Call createDiscordClient first.');
  }
  return clientInstance;
}

export async function startDiscordBot(onMessage: MessageHandler): Promise<Client> {
  log.info('Starting Discord bot');

  const config = getConfig();
  const client = createDiscordClient();

  setupEventHandlers(client, onMessage);

  await client.login(config.DISCORD_TOKEN);
  log.info('Discord bot logged in');

  return client;
}

export * from './api';
export * from './events';
export * from './types';
export * from './slash-commands';
