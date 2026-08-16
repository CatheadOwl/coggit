import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ProjectLockError, WatchLeaseError } from '../../core/locks';
import {
  NodeProjectLockManager,
  NodeWatchLeaseManager,
  projectWriteLockPath,
  watchLeaseLockPath,
} from './locks';
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

suite('node watch leases', () => {
  test('try-acquire returns a handle and a second acquisition returns null', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager();

    const first = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.first' },
    );
    assert.ok(first);

    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as {
      pid: number;
      context: { owner: string; operation: string };
    };
    assert.strictEqual(lock.pid, process.pid);
    assert.strictEqual(lock.context.owner, 'cli');
    assert.strictEqual(lock.context.operation, 'test.watch.first');

    const second = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'mcp', operation: 'test.watch.second' },
    );
    assert.strictEqual(second, null);

    await first.release();
    await assert.rejects(nodeFs.stat(lockPath), { code: 'ENOENT' });
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('live-holder path returns null without waiting', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const leases = new NodeWatchLeaseManager();
    const first = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.live-holder' },
    );
    assert.ok(first);

    const startedAt = Date.now();
    const second = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'mcp', operation: 'test.watch.live-decline' },
    );

    assert.strictEqual(second, null);
    assert.ok(Date.now() - startedAt < 100);

    await first.release();
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('reclaims stale same-host dead-pid watch leases', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager({ staleAfterMs: 1 });

    await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
    await nodeFs.writeFile(lockPath, JSON.stringify({
      token: 'stale-watch-token',
      pid: 99999999,
      hostname: os.hostname(),
      acquiredAt: '2000-01-01T00:00:00.000Z',
      context: { owner: 'mcp', operation: 'stale.watch' },
    }), 'utf8');

    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.reclaim' },
    );

    assert.ok(lease);
    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as {
      token: string;
      context: { owner: string; operation: string };
    };
    assert.notStrictEqual(lock.token, 'stale-watch-token');
    assert.strictEqual(lock.context.operation, 'test.watch.reclaim');

    await lease.release();
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('returns null when stale reclaim loses the race', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager({ staleAfterMs: 1 });

    await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
    await nodeFs.mkdir(`${lockPath}.reclaim`);
    await nodeFs.writeFile(lockPath, JSON.stringify({
      token: 'stale-watch-token',
      pid: 99999999,
      hostname: os.hostname(),
      acquiredAt: '2000-01-01T00:00:00.000Z',
      context: { owner: 'mcp', operation: 'stale.watch.race' },
    }), 'utf8');

    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.reclaim-race' },
    );

    assert.strictEqual(lease, null);
    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as { token: string };
    assert.strictEqual(lock.token, 'stale-watch-token');

    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('does not reclaim cross-host stale watch leases', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager({ staleAfterMs: 1 });

    await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
    await nodeFs.writeFile(lockPath, JSON.stringify({
      token: 'cross-host-watch-token',
      pid: 99999999,
      hostname: `${os.hostname()}-remote`,
      acquiredAt: '2000-01-01T00:00:00.000Z',
      context: { owner: 'mcp', operation: 'cross-host.watch' },
    }), 'utf8');

    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.cross-host' },
    );

    assert.strictEqual(lease, null);
    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as { token: string };
    assert.strictEqual(lock.token, 'cross-host-watch-token');

    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('renew keeps a lease fresh', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager({ staleAfterMs: 1000 });
    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.renew' },
    );
    assert.ok(lease);

    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as Record<string, unknown>;
    await nodeFs.writeFile(lockPath, JSON.stringify({
      ...lock,
      pid: 99999999,
      acquiredAt: '2000-01-01T00:00:00.000Z',
    }), 'utf8');

    await lease.renew();

    const renewedRaw = await nodeFs.readFile(lockPath, 'utf8');
    const renewed = JSON.parse(renewedRaw) as { acquiredAt: string };
    assert.ok(Date.parse(renewed.acquiredAt) > Date.parse('2000-01-01T00:00:00.000Z'));

    const second = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'mcp', operation: 'test.watch.after-renew' },
    );
    assert.strictEqual(second, null);

    await lease.release();
    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('renew after reclaim throws a reclaimed watch lease error', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager({ staleAfterMs: 1 });
    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.renew-reclaimed' },
    );
    assert.ok(lease);

    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as Record<string, unknown>;
    await nodeFs.writeFile(lockPath, JSON.stringify({
      ...lock,
      token: 'replacement-watch-token',
    }), 'utf8');

    await assert.rejects(
      lease.renew(),
      (error: unknown) => {
        assert.ok(error instanceof WatchLeaseError);
        assert.strictEqual(error.code, 'COGGIT_WATCH_LEASE_RECLAIMED');
        return true;
      },
    );

    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('release with stale token does not unlink another holder lease', async () => {
    const projectPath = await tempProject();
    const projectRoot = pathToUriComponents(projectPath);
    const lockPath = watchLeaseLockPath(projectRoot);
    const leases = new NodeWatchLeaseManager();
    const lease = await leases.tryAcquireWatchLease(
      projectRoot,
      { owner: 'cli', operation: 'test.watch.release-stale' },
    );
    assert.ok(lease);

    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const lock = JSON.parse(raw) as Record<string, unknown>;
    await nodeFs.writeFile(lockPath, JSON.stringify({
      ...lock,
      token: 'replacement-watch-token',
    }), 'utf8');

    await lease.release();

    const afterReleaseRaw = await nodeFs.readFile(lockPath, 'utf8');
    const afterRelease = JSON.parse(afterReleaseRaw) as { token: string };
    assert.strictEqual(afterRelease.token, 'replacement-watch-token');

    await nodeFs.rm(projectPath, { recursive: true, force: true });
  });

  test('watch lease lock path is distinct from project write lock path', async () => {
    const projectRoot = pathToUriComponents(await tempProject());

    assert.notStrictEqual(
      watchLeaseLockPath(projectRoot),
      projectWriteLockPath(projectRoot),
    );
  });
});
