import { readFileSync } from 'fs';
import { join } from 'path';
import { createLogger } from '../utils/logger';

const log = createLogger('TEMPLATES');

const TEMPLATES_DIR = join(__dirname, '..', '..', 'templates');

const templateCache = new Map<string, string>();

export function loadTemplate(name: string): string {
  log.info(`Loading template: ${name}`);

  if (templateCache.has(name)) {
    const cached = templateCache.get(name)!;
    log.info(`Template loaded from cache, length: ${cached.length}`);
    return cached;
  }

  const filePath = join(TEMPLATES_DIR, `${name}.txt`);
  try {
    const content = readFileSync(filePath, 'utf-8');
    templateCache.set(name, content);
    log.info(`Template loaded from file, length: ${content.length}`);
    return content;
  } catch (error) {
    log.error(`Failed to load template: ${name}`, { error: String(error) });
    throw new Error(`Template not found: ${name}`);
  }
}

export function loadPrompt(category: string): string {
  log.info(`Loading prompt: ${category}`);
  const template = loadTemplate(`prompts/${category}`);
  return template;
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    rendered = rendered.split(placeholder).join(value);
  }
  return rendered;
}
