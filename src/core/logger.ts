export type CoggitLogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CoggitLogEvent {
  level: CoggitLogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface CoggitLogger {
  log(event: CoggitLogEvent): void;
}

const LOG_LEVEL_PRIORITIES: Record<CoggitLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const nullCoggitLogger: CoggitLogger = {
  log: () => undefined,
};

export function logEvent(
  logger: CoggitLogger | undefined,
  level: CoggitLogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  logger?.log({
    level,
    category,
    message,
    data,
  });
}

export function debugLog(
  logger: CoggitLogger | undefined,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  logEvent(logger, 'debug', category, message, data);
}

export function infoLog(
  logger: CoggitLogger | undefined,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  logEvent(logger, 'info', category, message, data);
}

export function warnLog(
  logger: CoggitLogger | undefined,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  logEvent(logger, 'warn', category, message, data);
}

export function errorLog(
  logger: CoggitLogger | undefined,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  logEvent(logger, 'error', category, message, data);
}

export function createEnvCoggitLogger(prefix = '[coggit]'): CoggitLogger {
  const configuredLevel = getEnvLogLevel();
  if (!configuredLevel) {
    return nullCoggitLogger;
  }

  return {
    log(event: CoggitLogEvent): void {
      if (LOG_LEVEL_PRIORITIES[event.level] < LOG_LEVEL_PRIORITIES[configuredLevel]) {
        return;
      }

      const payload = event.data && Object.keys(event.data).length > 0
        ? ` ${JSON.stringify(event.data)}`
        : '';
      const line = `${prefix} [${event.level}] ${event.category}: ${event.message}${payload}`;
      if (event.level === 'error') {
        console.error(line);
      } else if (event.level === 'warn') {
        console.warn(line);
      } else {
        console.debug(line);
      }
    },
  };
}

function getEnvLogLevel(): CoggitLogLevel | undefined {
  const logLevel = process.env.COGGIT_LOG_LEVEL?.toLowerCase();
  if (logLevel === 'debug' || logLevel === 'info' || logLevel === 'warn' || logLevel === 'error') {
    return logLevel;
  }

  const debug = process.env.COGGIT_DEBUG?.toLowerCase();
  if (debug === 'debug' || debug === '1' || debug === 'true' || debug === 'yes') {
    return 'debug';
  }

  return undefined;
}
