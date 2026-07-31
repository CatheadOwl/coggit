import * as assert from 'node:assert';

import { createEnvCoggitLogger } from './logger';

suite('Coggit logger', () => {
  const originalLogLevel = process.env.COGGIT_LOG_LEVEL;
  const originalDebug = process.env.COGGIT_DEBUG;
  const originalConsole = console;

  teardown(() => {
    restoreEnv('COGGIT_LOG_LEVEL', originalLogLevel);
    restoreEnv('COGGIT_DEBUG', originalDebug);
    setConsole(originalConsole);
  });

  test('COGGIT_LOG_LEVEL filters events by severity', () => {
    process.env.COGGIT_LOG_LEVEL = 'warn';
    delete process.env.COGGIT_DEBUG;
    const lines: string[] = [];
    setConsole({
      ...originalConsole,
      debug: (line?: unknown) => lines.push(String(line)),
      warn: (line?: unknown) => lines.push(String(line)),
    });

    const logger = createEnvCoggitLogger('[test]');
    logger.log({ level: 'debug', category: 'registry.trace', message: 'debug event' });
    logger.log({ level: 'warn', category: 'registry.io', message: 'warn event' });

    assert.deepStrictEqual(lines, [
      '[test] [warn] registry.io: warn event',
    ]);
  });

  test('COGGIT_DEBUG keeps the existing debug opt-in behavior', () => {
    delete process.env.COGGIT_LOG_LEVEL;
    process.env.COGGIT_DEBUG = '1';
    const lines: string[] = [];
    setConsole({
      ...originalConsole,
      debug: (line?: unknown) => lines.push(String(line)),
    });

    const logger = createEnvCoggitLogger('[test]');
    logger.log({ level: 'debug', category: 'registry.trace', message: 'debug event' });

    assert.deepStrictEqual(lines, [
      '[test] [debug] registry.trace: debug event',
    ]);
  });

  test('COGGIT_LOG_LEVEL takes precedence over COGGIT_DEBUG', () => {
    process.env.COGGIT_LOG_LEVEL = 'warn';
    process.env.COGGIT_DEBUG = '1';
    const lines: string[] = [];
    setConsole({
      ...originalConsole,
      debug: (line?: unknown) => lines.push(`debug:${String(line)}`),
      warn: (line?: unknown) => lines.push(`warn:${String(line)}`),
    });

    const logger = createEnvCoggitLogger('[test]');
    logger.log({ level: 'debug', category: 'registry.trace', message: 'debug event' });
    logger.log({ level: 'warn', category: 'registry.io', message: 'warn event' });

    assert.deepStrictEqual(lines, [
      'warn:[test] [warn] registry.io: warn event',
    ]);
  });
});

function setConsole(value: Console): void {
  Object.defineProperty(globalThis, 'console', {
    configurable: true,
    value,
  });
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
