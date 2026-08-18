import * as assert from 'node:assert';

import type { CoggitProject, SourcePathResolution } from '../core/interfaces';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '../core/types';
import { runStatus } from './status';

function uri(path: string) {
  return { scheme: 'file', authority: '', path, query: '', fragment: '' };
}

function project(label: string, calls: string[]): CoggitProject {
  const root: CoggitWorkspaceRoot = {
    id: label,
    label,
    workspaceFolder: { uri: uri(`/workspace/${label}`), name: label, index: 0 },
    configUri: uri(`/workspace/${label}/.coggit/config.yaml`),
    projectRootUri: uri(`/workspace/${label}`),
    sourceRootUri: uri(`/workspace/${label}/src`),
    cognitionRootUri: uri(`/workspace/${label}/cognition`),
  };
  const node: CoggitTreeNode = {
    id: `${label}-root`,
    kind: 'root',
    label,
    resourceUri: root.sourceRootUri,
    sourceUri: root.sourceRootUri,
    relativePath: '.',
    contextValue: 'coggitRootUntracked',
    root,
  };

  return {
    root,
    async resolveSourcePath(sourcePath: string): Promise<SourcePathResolution> {
      calls.push(`${label}:${sourcePath}`);
      return {
        node: sourcePath === '.' ? node : undefined,
        normalizedPath: sourcePath,
      };
    },
  } as CoggitProject;
}

suite('CLI status', () => {
  test('omitted path and explicit dot use the same first-match projection', async () => {
    const omittedCalls: string[] = [];
    const explicitCalls: string[] = [];
    const omittedProjects = [project('first', omittedCalls), project('second', omittedCalls)];
    const explicitProjects = [project('first', explicitCalls), project('second', explicitCalls)];

    const omitted = await runStatus(omittedProjects, undefined);
    const explicit = await runStatus(explicitProjects, '.');

    assert.strictEqual(omitted, explicit);
    assert.deepStrictEqual(omittedCalls, ['first:.']);
    assert.deepStrictEqual(explicitCalls, ['first:.']);
  });
});
