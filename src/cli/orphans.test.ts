import * as assert from 'node:assert';

import type { CoggitProject, UriComponents } from '../core/interfaces';
import type { OrphanedCognitionEntry } from '../core/types';
import { runOrphans } from './orphans';

function uri(path: string): UriComponents {
  return {
    scheme: 'file',
    authority: '',
    path,
    query: '',
    fragment: '',
  };
}

function orphan(overrides: Partial<OrphanedCognitionEntry> = {}): OrphanedCognitionEntry {
  return {
    registryKey: 'missing.ts',
    type: 'leaf',
    sourcePath: 'src/missing.ts',
    sourceUri: uri('/workspace/src/missing.ts'),
    cognitionPath: 'cognition/missing.ts.md',
    cognitionUri: uri('/workspace/cognition/missing.ts.md'),
    ...overrides,
  };
}

function project(label: string, orphans: OrphanedCognitionEntry[]): CoggitProject {
  return {
    root: {
      id: label,
      label,
      workspaceFolder: { uri: uri('/workspace'), name: label, index: 0 },
      configUri: uri('/workspace/.coggit/config.yaml'),
      projectRootUri: uri('/workspace'),
      sourceRootUri: uri('/workspace/src'),
      cognitionRootUri: uri('/workspace/cognition'),
    },
    listOrphanedCognition: async () => orphans,
  } as CoggitProject;
}

suite('CogGit CLI orphans', () => {
  test('renders an empty orphan list', async () => {
    assert.strictEqual(
      await runOrphans([project('workspace', [])]),
      'No orphaned cognition files found.',
    );
  });

  test('renders orphaned cognition entries grouped by project', async () => {
    const output = await runOrphans([
      project('workspace', [orphan()]),
      project('library', []),
    ]);

    assert.match(output, /Found 1 orphaned cognition file\(s\):/);
    assert.match(output, /Project: workspace/);
    assert.match(output, /- cognition\/missing\.ts\.md/);
    assert.match(output, /Source: src\/missing\.ts/);
    assert.match(output, /Type: leaf/);
    assert.doesNotMatch(output, /Project: library/);
  });

  test('renders structured JSON', async () => {
    const output = await runOrphans([project('workspace', [orphan()])], { json: true });
    const parsed = JSON.parse(output) as Array<{
      project: { label: string };
      orphans: Array<{ cognitionPath: string }>;
    }>;

    assert.strictEqual(parsed[0].project.label, 'workspace');
    assert.strictEqual(parsed[0].orphans[0].cognitionPath, 'cognition/missing.ts.md');
  });
});
