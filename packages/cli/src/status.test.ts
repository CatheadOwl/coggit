import * as assert from 'node:assert';
import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { CoggitProject, SourcePathResolution } from '@coggit/core';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '@coggit/core';
import { pathToUriComponents } from '@coggit/runtime-node';
import { runStatus } from './status';

function uri(path: string) {
  return { scheme: 'file', authority: '', path, query: '', fragment: '' };
}

function project(label: string, calls: string[], rootPath = `/workspace/${label}`): CoggitProject {
  const root: CoggitWorkspaceRoot = {
    id: label,
    label,
    workspaceFolder: { uri: uri(rootPath), name: label, index: 0 },
    configUri: uri(`${rootPath}/.coggit/config.yaml`),
    projectRootUri: uri(rootPath),
    sourceRootUri: uri(`${rootPath}/src`),
    cognitionRootUri: uri(`${rootPath}/cognition`),
  };
  const rootNode: CoggitTreeNode = {
    id: `${label}-root`,
    kind: 'root',
    label,
    resourceUri: root.sourceRootUri,
    sourceUri: root.sourceRootUri,
    relativePath: '.',
    contextValue: 'coggitRootUntracked',
    root,
  };
  const featureNode: CoggitTreeNode = {
    id: `${label}-feature`,
    kind: 'folder',
    label: 'feature',
    resourceUri: uri(`${rootPath}/src/feature`),
    sourceUri: uri(`${rootPath}/src/feature`),
    relativePath: 'feature',
    contextValue: 'coggitFolderUntracked',
    root,
  };

  return {
    root,
    async resolveSourcePath(sourcePath: string): Promise<SourcePathResolution> {
      calls.push(`${label}:${sourcePath}`);
      return {
        node: sourcePath === '.' ? rootNode : sourcePath === 'feature' ? featureNode : undefined,
        normalizedPath: sourcePath,
      };
    },
  } as CoggitProject;
}

suite('CLI status', () => {
  test('omitted path from the project root and explicit dot use the same projection', async () => {
    const previousCwd = process.cwd();
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-status-'));
    const omittedCalls: string[] = [];
    const explicitCalls: string[] = [];
    const normalizedRoot = pathToUriComponents(tempRoot).path;
    const omittedProjects = [project('first', omittedCalls, normalizedRoot), project('second', omittedCalls)];
    const explicitProjects = [project('first', explicitCalls, normalizedRoot), project('second', explicitCalls)];

    try {
      process.chdir(tempRoot);
      const omitted = await runStatus(omittedProjects, undefined);
      const explicit = await runStatus(explicitProjects, '.');

      assert.strictEqual(omitted, explicit);
      assert.deepStrictEqual(omittedCalls, ['first:.']);
      assert.deepStrictEqual(explicitCalls, ['first:.']);
    } finally {
      process.chdir(previousCwd);
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('omitted path resolves through the current working directory source view', async () => {
    const previousCwd = process.cwd();
    const tempRoot = await nodeFs.mkdtemp(path.join(os.tmpdir(), 'coggit-cli-status-'));
    await nodeFs.mkdir(path.join(tempRoot, 'src', 'feature'), { recursive: true });
    try {
      process.chdir(path.join(tempRoot, 'src', 'feature'));
      const calls: string[] = [];

      const output = await runStatus([project('project', calls, pathToUriComponents(tempRoot).path)], undefined);

      assert.match(output, /Source: feature/);
      assert.deepStrictEqual(calls, ['project:feature']);
    } finally {
      process.chdir(previousCwd);
      await nodeFs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
