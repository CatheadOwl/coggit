import * as assert from 'node:assert';
import type { FSWatcher } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  buildSnapshotFromProjects,
  createWatchHost,
  discoverCoggitProjects,
  initProject,
  statusOperation,
  type WatchHostObservationResult,
  type WatchObservation,
} from '../../core';
import { createNodeCoggitServices } from './index';
import { pathToUriComponents } from './uri';
import { createNodeFileWatchObserver } from './watch';

suite('node file watch observer', () => {
  test('feeds real source and cognition file changes through the native host', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const sourcePath = path.join(tempRoot, 'src', 'tracked.ts');
    const cognitionPath = path.join(tempRoot, 'cognition', 'tracked.ts.md');
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
        persistent: false,
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
        await sleep(250);
        await nodeFs.writeFile(sourcePath, 'export const value = "B";\n', 'utf8');
        await waitFor(() => results.some((result) =>
          result.observation.domain === 'source'
          && result.applyResult?.sourceObservationCount === 1,
        ));

        await nodeFs.writeFile(cognitionPath, maintainedCognition('source value B relationship'), 'utf8');
        await waitFor(() => results.some((result) =>
          result.observation.domain === 'cognition'
          && result.applyResult?.passiveAcceptanceCount === 1,
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
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
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
        persistent: false,
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
        await sleep(250);
        await nodeFs.appendFile(path.join(tempRoot, '.coggit', 'config.yaml'), '# watched\n', 'utf8');
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

  test('maps config events without filenames to config.yaml', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const observations: WatchObservation[] = [];
    const fakeWatch = new FakeWatchDirectory();

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
        persistent: false,
        watchDirectory: fakeWatch.watchDirectory,
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) => {
        observations.push(observation);
        return createWatchHost({
          projects: [project],
          snapshotProvider: () => buildSnapshotFromProjects([project]),
        }).observe(observation);
      });

      try {
        const configDirectory = path.join(tempRoot, '.coggit');
        await waitFor(() => fakeWatch.hasWatcher(configDirectory));
        fakeWatch.emit(configDirectory, 'change', null);

        await waitFor(() => observations.some((observation) =>
          observation.domain === 'config'
          && observation.kind === 'change'
          && observation.uri.path.endsWith('/.coggit/config.yaml'),
        ));
      } finally {
        subscription.dispose();
      }
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('allowlists known config file events under the config directory', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const observations: WatchObservation[] = [];
    const fakeWatch = new FakeWatchDirectory();

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
        persistent: false,
        watchDirectory: fakeWatch.watchDirectory,
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) => {
        observations.push(observation);
        return createWatchHost({
          projects: [project],
          snapshotProvider: () => buildSnapshotFromProjects([project]),
        }).observe(observation);
      });

      try {
        const configDirectory = path.join(tempRoot, '.coggit');
        await waitFor(() => fakeWatch.hasWatcher(configDirectory));
        fakeWatch.emit(configDirectory, 'change', 'registry.json');
        await sleep(100);

        assert.strictEqual(observations.length, 0);

        fakeWatch.emit(configDirectory, 'change', 'config.yaml');
        await waitFor(() => observations.length === 1);
        assert.strictEqual(observations[0].domain, 'config');
        assert.strictEqual(observations[0].kind, 'change');
        assert.ok(observations[0].uri.path.endsWith('/.coggit/config.yaml'));
      } finally {
        subscription.dispose();
      }
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('replaces stale subtree watchers when a watched directory is recreated quickly', async function () {
    this.timeout(10000);

    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-node-watch-'));
    const fakeWatch = new FakeWatchDirectory();

    try {
      const services = createNodeCoggitServices({ workspacePath: tempRoot });
      await initProject(services.fs, pathToUriComponents(tempRoot), {
        sourceRoot: 'src',
        cognitionRoot: 'cognition',
      });
      const nestedDirectory = path.join(tempRoot, 'src', 'nested');
      await nodeFs.mkdir(nestedDirectory, { recursive: true });

      const [project] = await discoverCoggitProjects(services);
      assert.ok(project);

      const observer = createNodeFileWatchObserver({
        roots: [project.root],
        persistent: false,
        watchDirectory: fakeWatch.watchDirectory,
      });
      const subscription = observer.subscribe(async (observation: WatchObservation) =>
        createWatchHost({
          projects: [project],
          snapshotProvider: () => buildSnapshotFromProjects([project]),
        }).observe(observation));

      try {
        const sourceDirectory = path.join(tempRoot, 'src');
        await waitFor(() => fakeWatch.hasWatcher(sourceDirectory));
        await waitFor(() => fakeWatch.hasWatcher(nestedDirectory));

        const originalNestedWatcher = fakeWatch.currentWatcher(nestedDirectory);
        fakeWatch.emit(sourceDirectory, 'rename', 'nested');

        await waitFor(() => {
          const replacementNestedWatcher = fakeWatch.currentWatcher(nestedDirectory);
          return originalNestedWatcher.closed
            && replacementNestedWatcher !== originalNestedWatcher;
        });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FakeWatchListener = (
  eventType: string,
  filename: string | Buffer | null,
) => void;

class FakeWatchDirectory {
  private readonly watchers = new Map<string, FakeFsWatcher[]>();

  readonly watchDirectory = (
    directoryPath: string,
    _options: { persistent: boolean },
    listener: FakeWatchListener,
  ): FSWatcher => {
    const watcher = new FakeFsWatcher(listener);
    const key = path.resolve(directoryPath);
    const watchers = this.watchers.get(key) ?? [];
    watchers.push(watcher);
    this.watchers.set(key, watchers);
    return watcher as unknown as FSWatcher;
  };

  hasWatcher(directoryPath: string): boolean {
    return this.liveWatchers(directoryPath).length > 0;
  }

  currentWatcher(directoryPath: string): FakeFsWatcher {
    const [watcher] = this.liveWatchers(directoryPath).slice(-1);
    assert.ok(watcher, `Expected watcher for ${directoryPath}`);
    return watcher;
  }

  emit(directoryPath: string, eventType: string, filename: string | Buffer | null): void {
    this.currentWatcher(directoryPath).emit(eventType, filename);
  }

  private liveWatchers(directoryPath: string): FakeFsWatcher[] {
    return (this.watchers.get(path.resolve(directoryPath)) ?? [])
      .filter((watcher) => !watcher.closed);
  }
}

class FakeFsWatcher {
  closed = false;

  constructor(private readonly listener: FakeWatchListener) {}

  on(_event: string, _listener: (error: Error) => void): this {
    return this;
  }

  close(): void {
    this.closed = true;
  }

  emit(eventType: string, filename: string | Buffer | null): void {
    this.listener(eventType, filename);
  }
}
