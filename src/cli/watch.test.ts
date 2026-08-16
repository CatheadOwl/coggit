import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  discoverCoggitProjects,
  initProject,
  type WatchObservationHandler,
  type WatchObserver,
} from '../core';
import { createNodeCoggitServices } from '../runtime/node';
import { pathToUriComponents, uriComponentsToPath } from '../runtime/node/uri';
import { startWatchSession } from './watch';

suite('coggit watch session', () => {
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
      const session = startWatchSession(
        [project],
        { json: false },
        (line) => lines.push(line),
        () => observer,
      );

      assert.ok(handler);
      await handler!({ domain: 'config', uri: project.root.configUri, kind: 'change' });

      assert.strictEqual(lines.length, 1);
      assert.strictEqual(lines[0], `config change ${uriComponentsToPath(project.root.configUri)}`);

      session.dispose();
      assert.strictEqual(disposed, true);
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
      const session = startWatchSession(
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

      session.dispose();
    } finally {
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('throws when no projects are discovered', () => {
    assert.throws(() => startWatchSession([], {}), /No CogGit project found/);
  });
});
