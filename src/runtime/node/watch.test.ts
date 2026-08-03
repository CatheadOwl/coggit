import * as assert from 'node:assert';
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
      const reviewed = await project.markReviewedUnchanged('tracked.ts');
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
