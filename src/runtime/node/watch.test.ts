import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type ParcelWatcher = require('@parcel/watcher');

import {
  buildSnapshotFromProjects,
  discoverCoggitProjects,
  initProject,
  statusOperation,
} from '@coggit/core';
import {
  createWatchHost,
  type WatchHostObservationResult,
  type WatchObservation,
} from '@coggit/core/internal';
import { createNodeCoggitServices } from './index';
import { pathToUriComponents } from './uri';
import { createNodeFileWatchObserver } from './watch';

suite('node file watch observer', () => {
  test('feeds real source and cognition file changes through the native host', async function () {
    this.timeout(20000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const sourcePath = path.join(tempRoot, 'src', 'tracked.ts');
    const cognitionPath = path.join(tempRoot, 'cognition', 'tracked.ts.md');
    const configPath = path.join(tempRoot, '.coggit', 'config.yaml');
    const errors: Error[] = [];
    const results: WatchHostObservationResult[] = [];

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      await nodeFs.mkdir(path.dirname(sourcePath), { recursive: true });
      await nodeFs.writeFile(sourcePath, 'export const value = "A";\n', 'utf8');
      await nodeFs.writeFile(cognitionPath, maintainedCognition('initial accepted relationship'), 'utf8');

      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);
      const reviewed = await project.markResolved('tracked.ts');
      assert.ok(reviewed.accepted);
      assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        onError: (error) => errors.push(error),
      });
      const host = createWatchHost({
        projects: [project],
        snapshotProvider: () => buildSnapshotFromProjects([project]),
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) => {
        const result = await host.observe(observation);
        results.push(result);
        return result;
      });

      try {
        // Prime the native watcher: the first native subscription arms
        // asynchronously, so repeatedly touch config.yaml until it observably
        // fires, then start the real writes instead of sleeping.
        await probeWatcherUntilArmed(configPath, () => results.length > 0);
        results.length = 0;

        await nodeFs.writeFile(sourcePath, 'export const value = "B";\n', 'utf8');
        await waitFor(() => results.some((result) =>
          result.observation.domain === 'source'
          && (result.applyResult?.sourceObservationCount ?? 0) >= 1,
        ));

        await nodeFs.writeFile(cognitionPath, maintainedCognition('source value B relationship'), 'utf8');
        await waitFor(() => results.some((result) =>
          result.observation.domain === 'cognition'
          && (result.applyResult?.passiveAcceptanceCount ?? 0) >= 1,
        ));
      } finally {
        subscription.dispose();
      }

      assert.deepStrictEqual(errors, []);
      assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('reports config file changes as config observations', async function () {
    this.timeout(20000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const configPath = path.join(tempRoot, '.coggit', 'config.yaml');
    const observations: WatchObservation[] = [];
    const errors: Error[] = [];

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        onError: (error) => errors.push(error),
      });
      const host = createWatchHost({
        projects: [project],
        snapshotProvider: () => buildSnapshotFromProjects([project]),
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) => {
        observations.push(observation);
        return host.observe(observation);
      });

      try {
        await probeWatcherUntilArmed(configPath, () => observations.length > 0);
        observations.length = 0;

        await nodeFs.appendFile(configPath, '# watched\n', 'utf8');
        await waitFor(() => observations.some((observation) =>
          observation.domain === 'config'
          && observation.kind === 'change',
        ));
      } finally {
        subscription.dispose();
      }

      assert.deepStrictEqual(errors, []);
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('allowlists config.yaml and maps parcel event types to watch kinds', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const callbacks = new Map<string, ParcelWatcher.SubscribeCallback>();
    const observations: WatchObservation[] = [];

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        subscribe: async (dir, callback) => {
          callbacks.set(path.resolve(dir), callback);
          return {
            unsubscribe: async () => {
              callbacks.delete(path.resolve(dir));
            },
          };
        },
      });
      const host = createWatchHost({
        projects: [project],
        snapshotProvider: () => buildSnapshotFromProjects([project]),
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) => {
        observations.push(observation);
        return host.observe(observation);
      });

      try {
        const configDirectory = path.join(tempRoot, '.coggit');
        await waitFor(() => callbacks.has(configDirectory));
        const emitConfig = callbacks.get(configDirectory)!;

        emitConfig(null, [{ type: 'update', path: path.join(configDirectory, 'registry.json') }]);
        await sleep(100);
        assert.strictEqual(observations.length, 0);

        emitConfig(null, [{ type: 'update', path: path.join(configDirectory, 'config.yaml') }]);
        emitConfig(null, [{ type: 'create', path: path.join(configDirectory, 'config.yaml') }]);
        emitConfig(null, [{ type: 'delete', path: path.join(configDirectory, 'config.yaml') }]);
        await waitFor(() => observations.length === 3);

        assert.strictEqual(observations[0].domain, 'config');
        assert.strictEqual(observations[0].kind, 'change');
        assert.strictEqual(observations[1].kind, 'create');
        assert.strictEqual(observations[2].kind, 'delete');
      } finally {
        subscription.dispose();
      }
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('unsubscribes a stale subscription when dispose is followed by resubscribe', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const controlled = new ControlledSubscribe();

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      await nodeFs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        subscribe: controlled.subscribe,
      });
      const host = createWatchHost({
        projects: [project],
        snapshotProvider: () => buildSnapshotFromProjects([project]),
      });
      const handler = async (observation: WatchObservation) => host.observe(observation);

      const first = observer.subscribe(handler);
      await waitFor(() => controlled.calls.length === 3);
      first.dispose();

      const second = observer.subscribe(handler);
      await waitFor(() => controlled.calls.length === 6);

      const staleSubscriptions = controlled.resolveRange(0, 3);
      const liveSubscriptions = controlled.resolveRange(3, 6);

      // The first generation's in-flight subscriptions resolve after a dispose
      // and resubscribe; they must be unsubscribed, not leaked, while the
      // second generation's subscriptions stay live.
      await waitFor(() => staleSubscriptions.every((subscription) => subscription.unsubscribed));
      assert.ok(liveSubscriptions.every((subscription) => !subscription.unsubscribed));

      second.dispose();
      await waitFor(() => liveSubscriptions.every((subscription) => subscription.unsubscribed));
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('isolates a failed subscription to onError without dropping other targets', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const errors: Error[] = [];
    const subscribed: string[] = [];

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      await nodeFs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const sourceDir = path.resolve(path.join(tempRoot, 'src'));
      const cognitionDir = path.resolve(path.join(tempRoot, 'cognition'));
      const configDir = path.resolve(path.join(tempRoot, '.coggit'));

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        onError: (error) => errors.push(error),
        subscribe: async (dir, _callback) => {
          if (path.resolve(dir) === sourceDir) {
            throw new Error('source subscribe failed');
          }
          subscribed.push(path.resolve(dir));
          return { unsubscribe: async () => undefined };
        },
      });
      const host = createWatchHost({
        projects: [project],
        snapshotProvider: () => buildSnapshotFromProjects([project]),
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) =>
        host.observe(observation));

      try {
        await waitFor(() => errors.length === 1);
        assert.match(errors[0].message, /source subscribe failed/);
        assert.ok(subscribed.includes(cognitionDir));
        assert.ok(subscribed.includes(configDir));
      } finally {
        subscription.dispose();
      }
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

function maintainedCognition(label: string): string {
  return [
    '# tracked',
    '',
    `This cognition records the ${label} and explains the maintained behavior in detail.`,
    '',
    'It also records the native watcher verification boundary for future maintenance.',
    '',
    'The document remains the maintained reference for this source.',
    '',
  ].join('\n');
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(50);
  }
  assert.fail('Timed out waiting for expected node watcher observation.');
}

// The native watcher arms asynchronously after subscribe; a write issued before
// it is armed is silently lost. Touch the config file until the watcher visibly
// delivers a config observation, which proves the subscription is live.
async function probeWatcherUntilArmed(
  configPath: string,
  hasObservation: () => boolean,
  timeoutMs = 10000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await nodeFs.appendFile(configPath, '# watcher arm probe\n', 'utf8');
    await sleep(100);
    if (hasObservation()) {
      return;
    }
  }
  assert.fail('Timed out waiting for the native watcher to arm.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class ControlledSubscribe {
  readonly calls: Array<{
    dir: string;
    resolve: (subscription: ParcelWatcher.AsyncSubscription) => void;
  }> = [];

  readonly subscribe = (dir: string, _callback: ParcelWatcher.SubscribeCallback) =>
    new Promise<ParcelWatcher.AsyncSubscription>((resolve) => {
      this.calls.push({ dir, resolve });
    });

  resolveRange(start: number, end: number): TrackedSubscription[] {
    const subscriptions: TrackedSubscription[] = [];
    for (let i = start; i < end; i++) {
      const subscription = new TrackedSubscription(this.calls[i].dir);
      subscriptions.push(subscription);
      this.calls[i].resolve(subscription);
    }
    return subscriptions;
  }
}

class TrackedSubscription implements ParcelWatcher.AsyncSubscription {
  unsubscribed = false;

  constructor(readonly dir: string) {}

  async unsubscribe(): Promise<void> {
    this.unsubscribed = true;
  }
}
