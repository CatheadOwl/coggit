import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { CoggitProject, SourcePathResolution } from '@coggit/core';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '@coggit/core';
import { pathToUriComponents } from '../runtime/node/uri';
import { runSnapshot } from './snapshot';

function uri(path: string) {
  return { scheme: 'file', authority: '', path, query: '', fragment: '' };
}

function project(calls: string[], rootPath: string): CoggitProject {
  const root: CoggitWorkspaceRoot = {
    id: 'project',
    label: 'project',
    workspaceFolder: { uri: uri(rootPath), name: 'project', index: 0 },
    configUri: uri(`${rootPath}/.coggit/config.yaml`),
    projectRootUri: uri(rootPath),
    sourceRootUri: uri(`${rootPath}/src`),
    cognitionRootUri: uri(`${rootPath}/cognition`),
  };
  const featureNode: CoggitTreeNode = {
    id: 'project-feature',
    kind: 'folder',
    label: 'feature',
    resourceUri: uri(`${rootPath}/src/feature`),
    sourceUri: uri(`${rootPath}/src/feature`),
    relativePath: 'feature',
    contextValue: 'coggitFolderUntracked',
    root,
    children: [],
  };

  return {
    root,
    async resolveSourcePath(sourcePath: string): Promise<SourcePathResolution> {
      calls.push(sourcePath);
      return {
        node: sourcePath === 'feature' ? featureNode : undefined,
        normalizedPath: sourcePath,
      };
    },
  } as CoggitProject;
}

suite('CLI snapshot', () => {
  test('omitted path resolves through the current working directory source view', async () => {
    const previousCwd = process.cwd();
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-snapshot-'));
    await nodeFs.mkdir(path.join(tempRoot, 'src', 'feature'), { recursive: true });
    try {
      process.chdir(path.join(tempRoot, 'src', 'feature'));
      const calls: string[] = [];

      await runSnapshot([project(calls, pathToUriComponents(tempRoot).path)], undefined);

      assert.deepStrictEqual(calls, ['feature']);
    } finally {
      process.chdir(previousCwd);
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
