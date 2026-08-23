import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverCoggitProjects,
  initProject,
} from '@coggit/core';
import type { ProjectLockContext, UriComponents } from '@coggit/core';
import {
  WatchLeaseError,
  type WatchObservationHandler,
  type WatchObserver,
  type WatchLeaseHandle,
  type WatchLeaseManager,
} from '@coggit/core/internal';
import { createNodeCoggitServices, watchLeaseLockPath } from '../runtime/node';
import { pathToUriComponents, uriComponentsToPath } from '../runtime/node/uri';
import { openStrictWatchProject, startWatchSession } from './watch';

class FakeWatchLeaseHandle implements WatchLeaseHandle {
  renewCalls = 0;
  releaseCalls = 0;

  constructor(private readonly renewFn: () => Promise<void> = async () => undefined) {}

  async renew(): Promise<void> {
    this.renewCalls += 1;
    await this.renewFn();
  }

  async release(): Promise<void> {
    this.releaseCalls += 1;
  }
}

class FakeWatchLeaseManager implements WatchLeaseManager {
  readonly calls: Array<{ root: UriComponents; context: ProjectLockContext }> = [];
  private readonly leases: readonly (WatchLeaseHandle | null)[];

  constructor(leases: WatchLeaseHandle | null | readonly (WatchLeaseHandle | null)[]) {
    this.leases = Array.isArray(leases) ? leases : [leases];
  }

  async tryAcquireWatchLease(
    root: UriComponents,
    context: ProjectLockContext,
  ): Promise<WatchLeaseHandle | null> {
    const index = this.calls.length;
    this.calls.push({ root, context });
    return this.leases[index] ?? null;
  }
}

suite('coggit watch session', () => {
  test('opens only the exact initialized project root', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });

      const project = await openStrictWatchProject(services, tempRoot);

      assert.strictEqual(uriComponentsToPath(project.root.projectRootUri), tempRoot);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('does not search upward from a child directory for watch', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const childPath = path.join(tempRoot, 'src');

      await assert.rejects(
        openStrictWatchProject(services, childPath),
        /CogGit project is not initialized/,
      );
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('emits a text line per observation and disposes the subscription', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      let handler: WatchObservationHandler | undefined;
      let disposed = false;
      const observer: WatchObserver = {
        subscribe: (registered) => {
          handler = registered;
          return {
            dispose: () => {
              disposed = true;
            },
          };
        },
      };

      const lines: string[] = [];
      const session = await startWatchSession(
        [project],
        { json: false },
        (line) => lines.push(line),
        () => observer,
      );
      const lockPath = watchLeaseLockPath(project.root.projectRootUri);
      await nodeFs.stat(lockPath);

      assert.ok(handler);
      await handler!({ domain: 'config', uri: project.root.configUri, kind: 'change' });

      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0], `config change ${uriComponentsToPath(project.root.configUri)}`);

      await session.dispose();
      assert.strictEqual(disposed, true);
      await assert.rejects(nodeFs.stat(lockPath), { code: 'ENOENT' });
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('emits JSON Lines when the json option is set', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      let handler: WatchObservationHandler | undefined;
      const observer: WatchObserver = {
        subscribe: (registered) => {
          handler = registered;
          return { dispose: () => undefined };
        },
      };

      const lines: string[] = [];
      const session = await startWatchSession(
        [project],
        { json: true },
        (line) => lines.push(line),
        () => observer,
      );

      assert.ok(handler);
      await handler!({ domain: 'config', uri: project.root.configUri, kind: 'change' });

      assert.strictEqual(lines.length, 1);
      const parsed = JSON.parse(lines[0]);
      assert.strictEqual(parsed.observation.domain, 'config');
      assert.strictEqual(parsed.matchedProjectCount, 1);

      await session.dispose();
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('acquires the watch lease before subscribing and releases on dispose', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const lease = new FakeWatchLeaseHandle();
      const leaseManager = new FakeWatchLeaseManager(lease);
      let subscribedAfterAcquire = false;
      let disposed = false;
      const observer: WatchObserver = {
        subscribe: () => {
          subscribedAfterAcquire = leaseManager.calls.length === 1;
          return {
            dispose: () => {
              disposed = true;
            },
          };
        },
      };

      const session = await startWatchSession(
        [project],
        { leaseManager },
        () => undefined,
        () => observer,
      );

      assert.strictEqual(subscribedAfterAcquire, true);
      assert.strictEqual(leaseManager.calls.length, 1);
      assert.deepStrictEqual(leaseManager.calls[0].root, project.root.projectRootUri);
      assert.strictEqual(leaseManager.calls[0].context.owner, 'cli');
      assert.strictEqual(leaseManager.calls[0].context.operation, 'watch');
      assert.strictEqual(leaseManager.calls[0].context.projectLabel, project.root.label);

      await session.dispose();
      assert.strictEqual(disposed, true);
      assert.strictEqual(lease.releaseCalls, 1);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('does not subscribe when the watch lease is unavailable', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const leaseManager = new FakeWatchLeaseManager(null);
      const warnings: string[] = [];
      await assert.rejects(
        startWatchSession(
          [project],
          { leaseManager, warn: (line) => warnings.push(line) },
          () => undefined,
          () => {
            assert.fail('observer should not be created without the watch lease');
          },
        ),
        /No active watch lease available/,
      );

      assert.strictEqual(leaseManager.calls.length, 1);
      assert.deepStrictEqual(warnings, [`No active watch lease for ${project.root.label}; skipping watcher.`]);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('continues watching acquired projects while warning for busy projects', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const lease = new FakeWatchLeaseHandle();
      const leaseManager = new FakeWatchLeaseManager([lease, null]);
      const warnings: string[] = [];
      let subscriptions = 0;
      const observer: WatchObserver = {
        subscribe: () => {
          subscriptions += 1;
          return { dispose: () => undefined };
        },
      };

      const session = await startWatchSession(
        [project, project],
        { leaseManager, warn: (line) => warnings.push(line) },
        () => undefined,
        () => observer,
      );

      assert.strictEqual(leaseManager.calls.length, 2);
      assert.strictEqual(subscriptions, 1);
      assert.deepStrictEqual(warnings, [`No active watch lease for ${project.root.label}; skipping watcher.`]);

      await session.dispose();
      assert.strictEqual(lease.releaseCalls, 1);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('releases the watch lease if subscribing fails', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const lease = new FakeWatchLeaseHandle();
      const leaseManager = new FakeWatchLeaseManager(lease);
      await assert.rejects(
        startWatchSession(
          [project],
          { leaseManager },
          () => undefined,
          () => ({
            subscribe() {
              throw new Error('subscribe failed');
            },
          }),
        ),
        /subscribe failed/,
      );

      assert.strictEqual(lease.releaseCalls, 1);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('stops watching when the heartbeat reports a reclaimed lease', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const lease = new FakeWatchLeaseHandle(async () => {
        throw new WatchLeaseError(
          'reclaimed',
          'COGGIT_WATCH_LEASE_RECLAIMED',
          { owner: 'cli', operation: 'watch' },
        );
      });
      const leaseManager = new FakeWatchLeaseManager(lease);
      let disposeWatcher!: () => void;
      const watcherDisposed = new Promise<void>((resolve) => {
        disposeWatcher = resolve;
      });
      const observer: WatchObserver = {
        subscribe: () => ({
          dispose: disposeWatcher,
        }),
      };

      const session = await startWatchSession(
        [project],
        { leaseHeartbeatMs: 1, leaseManager },
        () => undefined,
        () => observer,
      );

      await withTimeout(watcherDisposed, 100, 'watcher was not disposed after lease reclaim');
      await withTimeout(session.done, 500, 'watch session did not finish after lease reclaim');
      assert.ok(lease.renewCalls >= 1);
      assert.strictEqual(lease.releaseCalls, 1);

      await session.dispose();
      assert.strictEqual(lease.releaseCalls, 1);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('warns when heartbeat renewal fails for another reason', async () => {
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-watch-'));
    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const lease = new FakeWatchLeaseHandle(async () => {
        throw new Error('disk full');
      });
      const leaseManager = new FakeWatchLeaseManager(lease);
      const warnings: string[] = [];
      const observer: WatchObserver = {
        subscribe: () => ({
          dispose: () => undefined,
        }),
      };

      const session = await startWatchSession(
        [project],
        { leaseHeartbeatMs: 1, leaseManager, warn: (line) => warnings.push(line) },
        () => undefined,
        () => observer,
      );

      await waitFor(
        () => warnings.length > 0,
        100,
        'watch lease renewal warning was not emitted',
      );

      assert.match(warnings[0], /Watch lease renewal warning for/);
      assert.match(warnings[0], /disk full/);

      await session.dispose();
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('throws when no projects are discovered', async () => {
    await assert.rejects(startWatchSession([], {}), /No CogGit project found/);
  });
});

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
