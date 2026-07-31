import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ProjectLockError } from '../../core/locks';
import { NodeProjectLockManager, projectWriteLockPath } from './locks';
import { pathToUriComponents } from './uri';

async function tempProject(): Promise<string> {
  return nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-lock-'));
}

suite('node project write locks', () => {
  test('creates and releases the project write lock file', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = projectWriteLockPath(projectRoot);
    const locks = new NodeProjectLockManager();

    await locks.withWriteLock(
      projectRoot,
      { owner: 'cli', operation: 'test.create-release' },
      async () => {
        const raw = await nodeFs.readFile(lockPath, 'utf8');
        const lock = JSON.parse(raw) as {
          pid: number;
          context: { owner: string; operation: string };
        };
        assert.strictEqual(lock.pid, process.pid);
        assert.strictEqual(lock.context.owner, 'cli');
        assert.strictEqual(lock.context.operation, 'test.create-release');
      },
    );

    await assert.rejects(nodeFs.stat(lockPath), { code: 'ENOENT' });
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('serializes concurrent writers in one Node process', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const locks = new NodeProjectLockManager({
      waitTimeoutMs: 1000,
      pollIntervalMs: 5,
    });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstMayRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted!: () => void;
    const firstHasLock = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });

    const first = locks.withWriteLock(
      projectRoot,
      { owner: 'cli', operation: 'test.first' },
      async () => {
        events.push('first:start');
        firstStarted();
        await firstMayRelease;
        events.push('first:end');
      },
    );
    await firstHasLock;

    const second = locks.withWriteLock(
      projectRoot,
      { owner: 'mcp', operation: 'test.second' },
      async () => {
        events.push('second:start');
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    events.push('release:first');
    releaseFirst();

    await Promise.all([first, second]);

    assert.deepStrictEqual(events, [
      'first:start',
      'release:first',
      'first:end',
      'second:start',
    ]);
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('fails with holder context after bounded contention timeout', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const locks = new NodeProjectLockManager({
      waitTimeoutMs: 20,
      pollIntervalMs: 5,
    });

    await assert.rejects(
      locks.withWriteLock(
        projectRoot,
        { owner: 'cli', operation: 'test.holder' },
        async () => locks.withWriteLock(
          projectRoot,
          { owner: 'mcp', operation: 'test.waiter' },
          async () => undefined,
        ),
      ),
      (error: unknown) => {
        assert.ok(error instanceof ProjectLockError);
        assert.strictEqual(error.code, 'COGGIT_WRITE_LOCK_BUSY');
        assert.strictEqual(error.context?.operation, 'test.waiter');
        assert.match(error.message, /operation=test\.holder/u);
        return true;
      },
    );

    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('reclaims stale same-host lock files for dead processes', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = projectWriteLockPath(projectRoot);
    const locks = new NodeProjectLockManager({
      waitTimeoutMs: 100,
      pollIntervalMs: 5,
      staleAfterMs: 1,
    });

    await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
    await nodeFs.writeFile(lockPath, JSON.stringify({
      token: 'stale-token',
      pid: 99999999,
      hostname: os.hostname(),
      acquiredAt: '2000-01-01T00:00:00.000Z',
      context: { owner: 'mcp', operation: 'stale.write' },
    }), 'utf8');

    const result = await locks.withWriteLock(
      projectRoot,
      { owner: 'cli', operation: 'test.reclaim' },
      async () => 'reclaimed',
    );

    assert.strictEqual(result, 'reclaimed');
    await assert.rejects(nodeFs.stat(lockPath), { code: 'ENOENT' });
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });
});
