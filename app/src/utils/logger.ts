type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const currentLevel = LOG_LEVELS[(process.env.LOG_LEVEL as LogLevel) || 'INFO'];

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
  if (LOG_LEVELS[level] < currentLevel) return;

  const dataStr = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[${level}] [${module}] ${message}${dataStr}`);
}

export function createLogger(module: string) {
  return {
    debug: (message: string, data?: Record<string, unknown>) => log('DEBUG', module, message, data),
    info: (message: string, data?: Record<string, unknown>) => log('INFO', module, message, data),
    warn: (message: string, data?: Record<string, unknown>) => log('WARN', module, message, data),
    error: (message: string, data?: Record<string, unknown>) => log('ERROR', module, message, data),
  };
}

export type Logger = ReturnType<typeof createLogger>;
