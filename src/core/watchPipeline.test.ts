import * as assert from 'assert';

import type { CoggitProject, UriComponents } from './interfaces';
import {
  applyWatchEventToProjects,
  planWatchRefresh,
  selectWatchRefreshMode,
  type NormalizedWatchEvent,
} from './watchPipeline';
import type { CoggitSnapshot, CoggitTreeNode, CoggitWorkspaceRoot } from './types';

function uri(path: string): UriComponents {
  return {
    scheme: 'file',
    authority: '',
    path,
    query: '',
    fragment: '',
  };
}

function projectWithRecorders(recorders: {
  readonly recordSourceChange?: CoggitProject['recordSourceChange'];
  readonly recordDirectoryEntryChange?: CoggitProject['recordDirectoryEntryChange'];
  readonly recordCognitionChange?: CoggitProject['recordCognitionChange'];
}): CoggitProject {
  return {
    recordSourceChange: recorders.recordSourceChange ?? (async () => false),
    recordDirectoryEntryChange: recorders.recordDirectoryEntryChange ?? (async () => false),
    recordCognitionChange: recorders.recordCognitionChange ?? (async () => false),
  } as CoggitProject;
}

const root: CoggitWorkspaceRoot = {
  id: 'workspace',
  label: 'workspace',
  workspaceFolder: {
    uri: uri('/workspace'),
    name: 'workspace',
    index: 0,
  },
  configUri: uri('/workspace/.coggit/config.yaml'),
  projectRootUri: uri('/workspace'),
  sourceRootUri: uri('/workspace/src'),
  cognitionRootUri: uri('/workspace/cognition'),
};

function fileNode(relativePath: string): CoggitTreeNode {
  const id = `file:${relativePath}`;
  return {
    id,
    kind: 'file',
    label: relativePath.slice(relativePath.lastIndexOf('/') + 1),
    resourceUri: uri(`/workspace/src/${relativePath}`),
    sourceUri: uri(`/workspace/src/${relativePath}`),
    cognitionUri: uri(`/workspace/cognition/${relativePath}.md`),
    relativePath,
    contextValue: 'coggitFilePresent',
    root,
  };
}

function snapshotWithTrackedFile(relativePath = 'tracked.ts'): CoggitSnapshot {
  const node = fileNode(relativePath);
  return {
    roots: [{
      id: 'root',
      kind: 'root',
      label: 'workspace',
      resourceUri: root.sourceRootUri,
      sourceUri: root.sourceRootUri,
      cognitionUri: root.cognitionRootUri,
      relativePath: '',
      contextValue: 'coggitRootPresent',
      root,
      children: [node],
    }],
    allNodes: [node],
    nodeById: new Map([[node.id, node]]),
    nodeBySourceUri: new Map([[`file:///workspace/src/${relativePath}`, node]]),
  };
}

suite('watch pipeline', () => {
  test('uses partial refresh for change events when a mapping index exists', () => {
    assert.strictEqual(selectWatchRefreshMode('change', true), 'partial');
  });

  test('uses full refresh for change events before a mapping index exists', () => {
    assert.strictEqual(selectWatchRefreshMode('change', false), 'full');
  });

  test('uses full refresh for create and delete events', () => {
    assert.strictEqual(selectWatchRefreshMode('create', true), 'full');
    assert.strictEqual(selectWatchRefreshMode('create', false), 'full');
    assert.strictEqual(selectWatchRefreshMode('delete', true), 'full');
    assert.strictEqual(selectWatchRefreshMode('delete', false), 'full');
  });

  test('records source change before directory entry evidence for structural source events', async () => {
    const calls: string[] = [];
    const event: NormalizedWatchEvent = {
      domain: 'source',
      uri: uri('/workspace/src/new-file.ts'),
      kind: 'create',
      generation: 7,
    };
    const project = projectWithRecorders({
      recordSourceChange: async (_uri, generation) => {
        calls.push(`source:${generation}`);
        return false;
      },
      recordDirectoryEntryChange: async (_uri, generation) => {
        calls.push(`directory:${generation}`);
        return true;
      },
    });

    const result = await applyWatchEventToProjects([project], event);

    assert.deepStrictEqual(calls, ['source:7', 'directory:7']);
    assert.strictEqual(result.domain, 'source');
    assert.strictEqual(result.kind, 'create');
    assert.strictEqual(result.generation, 7);
    assert.strictEqual(result.directoryRecordChangedCount, 1);
  });

  test('reports passive acceptance count for cognition events', async () => {
    const event: NormalizedWatchEvent = {
      domain: 'cognition',
      uri: uri('/workspace/cognition/tracked.ts.md'),
      kind: 'change',
      generation: 11,
    };
    const acceptingProject = projectWithRecorders({
      recordCognitionChange: async () => true,
    });
    const ignoredProject = projectWithRecorders({
      recordCognitionChange: async () => false,
    });

    const result = await applyWatchEventToProjects([acceptingProject, ignoredProject], event);

    assert.strictEqual(result.passiveAcceptanceCount, 1);
    assert.strictEqual(result.sourceRecordChangedCount, 0);
    assert.strictEqual(result.directoryRecordChangedCount, 0);
  });

  test('does not touch project recorders for config events', async () => {
    const calls: string[] = [];
    const event: NormalizedWatchEvent = {
      domain: 'config',
      uri: uri('/workspace/.coggit/config.yaml'),
      kind: 'change',
      generation: 13,
    };
    const project = projectWithRecorders({
      recordSourceChange: async () => {
        calls.push('source');
        return true;
      },
      recordDirectoryEntryChange: async () => {
        calls.push('directory');
        return true;
      },
      recordCognitionChange: async () => {
        calls.push('cognition');
        return true;
      },
    });

    const result = await applyWatchEventToProjects([project], event);

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(result.projectCount, 1);
    assert.strictEqual(result.passiveAcceptanceCount, 0);
  });

  test('plans partial refresh when changed path maps to an affected pair', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), [
      uri('/workspace/src/tracked.ts'),
    ]);

    assert.strictEqual(result.mode, 'partial');
    assert.strictEqual(result.reason, 'affected-pairs');
    assert.strictEqual(result.affected.pairs.length, 1);
    assert.strictEqual(result.affected.pairs[0].sourcePath, 'file:///workspace/src/tracked.ts');
  });

  test('plans partial refresh when changed cognition path maps to an affected pair', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), [
      uri('/workspace/cognition/tracked.ts.md'),
    ]);

    assert.strictEqual(result.mode, 'partial');
    assert.strictEqual(result.reason, 'affected-pairs');
    assert.strictEqual(result.affected.pairs.length, 1);
    assert.strictEqual(result.affected.pairs[0].cognitionPath, 'file:///workspace/cognition/tracked.ts.md');
  });

  test('plans full refresh for unmapped changes under a known root', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), [
      uri('/workspace/src/untracked.ts'),
    ]);

    assert.strictEqual(result.mode, 'full');
    assert.strictEqual(result.reason, 'known-root-unmapped');
    assert.strictEqual(result.affected.pairs.length, 0);
  });

  test('plans full refresh when a batch mixes mapped and unmapped known-root changes', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), [
      uri('/workspace/src/tracked.ts'),
      uri('/workspace/src/untracked.ts'),
    ]);

    assert.strictEqual(result.mode, 'full');
    assert.strictEqual(result.reason, 'known-root-unmapped');
    assert.strictEqual(result.affected.pairs.length, 1);
  });

  test('plans no refresh for changes outside known roots', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), [
      uri('/elsewhere/src/tracked.ts'),
    ]);

    assert.strictEqual(result.mode, 'none');
    assert.strictEqual(result.reason, 'outside-known-roots');
    assert.strictEqual(result.affected.pairs.length, 0);
  });

  test('plans no refresh for empty batches', () => {
    const result = planWatchRefresh(snapshotWithTrackedFile(), []);

    assert.strictEqual(result.mode, 'none');
    assert.strictEqual(result.reason, 'empty-batch');
    assert.strictEqual(result.affected.pairs.length, 0);
  });
});
