import * as assert from 'node:assert';

import { applyTreeDepth, projectTreeFromSnapshot, projectSnapshotTree } from './projection';
import type {
  CoggitSnapshot,
  CoggitTreeNode,
  CoggitWorkspaceRoot,
  NodeStatusResult,
  TreeProjectionNode,
} from './types';

// ─── Factory helpers ──────────────────────────────────────────────────────────

function makeRoot(overrides: Partial<CoggitWorkspaceRoot> = {}): CoggitWorkspaceRoot {
  return {
    id: 'test-root',
    label: 'test',
    workspaceFolder: { uri: { scheme: 'file', authority: '', path: '/workspace', query: '', fragment: '' }, name: 'test', index: 0 },
    configUri: { scheme: 'file', authority: '', path: '/workspace/.coggit/config.yaml', query: '', fragment: '' },
    projectRootUri: { scheme: 'file', authority: '', path: '/workspace', query: '', fragment: '' },
    sourceRootUri: { scheme: 'file', authority: '', path: '/workspace/src', query: '', fragment: '' },
    cognitionRootUri: { scheme: 'file', authority: '', path: '/workspace/.coggit/cognition', query: '', fragment: '' },
    ...overrides,
  };
}

function makeNode(overrides: Partial<CoggitTreeNode> & { relativePath: string; kind: CoggitTreeNode['kind'] }): CoggitTreeNode {
  const root = makeRoot();
  return {
    id: overrides.relativePath,
    label: overrides.relativePath.split('/').pop() ?? overrides.relativePath,
    resourceUri: { scheme: 'file', authority: '', path: `/workspace/src/${overrides.relativePath}`, query: '', fragment: '' },
    sourceUri: { scheme: 'file', authority: '', path: `/workspace/src/${overrides.relativePath}`, query: '', fragment: '' },
    contextValue: '',
    root,
    ...overrides,
    parent: overrides.parent ?? undefined,
    children: overrides.children ?? undefined,
  };
}

function makeStatus(overrides: Partial<NodeStatusResult> = {}): NodeStatusResult {
  return {
    observedStatus: 'fresh',
    ownObservedStatus: 'fresh' as const,
    coverage: {
      ownCognition: 'present',
      isMaterializable: true,
      missingMaterializableCount: 0,
      coveredCount: 1,
    },
    ...overrides,
  };
}

// ─── test: projectTreeFromSnapshot ────────────────────────────────────────────

suite('projectTreeFromSnapshot', () => {
  test('projects a single file node without children', () => {
    const node = makeNode({ relativePath: 'src/main.ts', kind: 'file' });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src/main.ts');
    assert.strictEqual(result[0].label, 'main.ts');
    assert.strictEqual(result[0].kind, 'file');
    assert.strictEqual(result[0].children, undefined);
  });

  test('projects a file with cognition and status', () => {
    const status = makeStatus({ observedStatus: 'stale', ownObservedStatus: 'stale' });
    const node = makeNode({
      relativePath: 'src/main.ts',
      kind: 'file',
      status,
      ownStatus: status,
      cognitionUri: { scheme: 'file', authority: '', path: '/workspace/.coggit/cognition/src/main.ts.md', query: '', fragment: '' },
    });
    const result = projectTreeFromSnapshot(node);

    assert.strictEqual(result[0].observedStatus, 'stale');
    assert.strictEqual(result[0].ownObservedStatus, 'stale');
    assert.strictEqual(result[0].tracked, true);
    assert.ok(result[0].cognition);
  });

  test('projects a file with cognition path relative to cognition root', () => {
    const node = makeNode({
      relativePath: 'src/main.ts',
      kind: 'file',
      cognitionUri: { scheme: 'file', authority: '', path: '/workspace/.coggit/cognition/src/main.ts.md', query: '', fragment: '' },
    });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });
    assert.strictEqual(result[0].cognition, 'src/main.ts.md');
  });

  test('projects a folder with matching child', () => {
    const child = makeNode({
      relativePath: 'src/main.ts',
      kind: 'file',
      parent: undefined as unknown as CoggitTreeNode,
      ownStatus: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [child],
      ownStatus: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    child.parent = folder;

    const result = projectTreeFromSnapshot(folder);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src');
    assert.strictEqual(result[0].children?.length, 1);
    assert.strictEqual(result[0].children![0].path, 'src/main.ts');
  });

  test('applies depth limiting — depth=0 strips children', () => {
    const child = makeNode({ relativePath: 'src/main.ts', kind: 'file', parent: undefined as unknown as CoggitTreeNode });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [child],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    child.parent = folder;

    const result = projectTreeFromSnapshot(folder, { depth: 0 });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].children, undefined);
  });

  test('applies depth limiting — depth=1 shows one level of children', () => {
    const grandchild = makeNode({ relativePath: 'src/core/main.ts', kind: 'file', parent: undefined as unknown as CoggitTreeNode });
    const child = makeNode({
      relativePath: 'src/core',
      kind: 'folder',
      children: [grandchild],
      parent: undefined as unknown as CoggitTreeNode,
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    grandchild.parent = child;
    const root = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [child],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    child.parent = root;

    const result = projectTreeFromSnapshot(root, { depth: 1 });
    assert.strictEqual(result[0].children?.length, 1);
    assert.strictEqual(result[0].children![0].path, 'src/core');
    // depth=1 should not expand grandchild
    assert.strictEqual(result[0].children![0].children, undefined);
  });

  test('renders empty array for undefined root (no match)', () => {
    const node = makeNode({ relativePath: 'untracked-file.ts', kind: 'file' });
    const result = projectTreeFromSnapshot(node, { scope: 'tracked' });
    // No status set, so ownCognition is undefined → not tracked → empty
    assert.strictEqual(result.length, 0);
  });

  test('renders empty array when node has no matching scope and no matching descendants', () => {
    const child = makeNode({ relativePath: 'src/main.ts', kind: 'file', parent: undefined as unknown as CoggitTreeNode });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [child],
    });
    child.parent = folder;

    const result = projectTreeFromSnapshot(folder, { scope: 'tracked' });
    assert.strictEqual(result.length, 0);
  });
});

// ─── test: projectSnapshotTree ────────────────────────────────────────────────

suite('projectSnapshotTree', () => {
  test('projects all roots from a snapshot', () => {
    const root1 = makeNode({ relativePath: 'pkg-a', kind: 'root' });
    const root2 = makeNode({ relativePath: 'pkg-b', kind: 'root' });
    const snapshot: CoggitSnapshot = {
      roots: [root1, root2],
      allNodes: [root1, root2],
      nodeById: new Map(),
      nodeBySourceUri: new Map(),
    };

    const result = projectSnapshotTree(snapshot, { scope: 'all' });
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, 'pkg-a');
    assert.strictEqual(result[1].path, 'pkg-b');
  });

  test('filters nodes by scope', () => {
    const tracked = makeNode({
      relativePath: 'src/tracked.ts',
      kind: 'file',
      ownStatus: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    const untracked = makeNode({
      relativePath: 'src/untracked.ts',
      kind: 'file',
    });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [tracked, untracked],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 1 } }),
    });
    tracked.parent = folder;
    untracked.parent = folder;

    const snapshot: CoggitSnapshot = {
      roots: [folder],
      allNodes: [folder, tracked, untracked],
      nodeById: new Map(),
      nodeBySourceUri: new Map(),
    };

    // tracked scope — only the tracked child kept
    const trackedResult = projectSnapshotTree(snapshot, { scope: 'tracked' });
    assert.strictEqual(trackedResult.length, 1);
    assert.strictEqual(trackedResult[0].children?.length, 1);
    assert.strictEqual(trackedResult[0].children![0].path, 'src/tracked.ts');

    // all scope — both children included
    const allResult = projectSnapshotTree(snapshot, { scope: 'all' });
    assert.strictEqual(allResult[0].children?.length, 2);
  });

  test('returns empty array for empty roots', () => {
    const snapshot: CoggitSnapshot = {
      roots: [],
      allNodes: [],
      nodeById: new Map(),
      nodeBySourceUri: new Map(),
    };
    assert.deepStrictEqual(projectSnapshotTree(snapshot), []);
  });

  test('includes description when present', () => {
    const node = makeNode({ relativePath: 'src/core', kind: 'folder', description: 'Core layer' });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });
    assert.strictEqual(result[0].description, 'Core layer');
  });

  test('skips description when absent', () => {
    const node = makeNode({ relativePath: 'src/core', kind: 'folder' });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });
    assert.strictEqual(result[0].description, undefined);
  });

  test('projected node omits children when empty even after scope filtering', () => {
    const child = makeNode({ relativePath: 'src/main.ts', kind: 'file', parent: undefined as unknown as CoggitTreeNode });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [child],
    });
    child.parent = folder;

    // With scope='all', the child doesn't match scope, but nodeContainsProjectionScope
    // returns false for folder because coveredCount is 0 (no status, not 'all' expansion).
    const result = projectTreeFromSnapshot(folder, { scope: 'tracked' });
    assert.strictEqual(result.length, 0);
  });
});

// ─── test: scope filtering ────────────────────────────────────────────────────

suite('projection scope filtering', () => {
  test('scope=issues keeps only nodes with issues', () => {
    const withIssues = makeNode({
      relativePath: 'src/buggy.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 },
        issues: [{
          diagnostic: { code: 'broken-links', severity: 'error', message: 'Broken link' },
          actions: [],
        }],
      }),
    });
    const clean = makeNode({
      relativePath: 'src/clean.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 },
      }),
    });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [withIssues, clean],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 2 } }),
    });
    withIssues.parent = folder;
    clean.parent = folder;

    const result = projectTreeFromSnapshot(folder, { scope: 'issues' });
    // Folder should be retained as skeleton because it contains the issues child
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].path, 'src');
    assert.strictEqual(result[0].children?.length, 1);
    assert.strictEqual(result[0].children![0].path, 'src/buggy.ts');
  });

  test('scope=untracked keeps only materializable missing nodes', () => {
    const materializable = makeNode({
      relativePath: 'src/new.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 0 },
      }),
    });
    const nonMaterializable = makeNode({
      relativePath: 'src/excluded.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'missing', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 0 },
      }),
    });
    const tracked = makeNode({
      relativePath: 'src/tracked.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 },
      }),
    });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [materializable, nonMaterializable, tracked],
      status: makeStatus({
        coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 },
      }),
    });
    materializable.parent = folder;
    nonMaterializable.parent = folder;
    tracked.parent = folder;

    const result = projectTreeFromSnapshot(folder, { scope: 'untracked' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].children?.length, 1);
    assert.strictEqual(result[0].children![0].path, 'src/new.ts');
  });

  test('scope=all includes everything', () => {
    const tracked = makeNode({
      relativePath: 'src/tracked.ts',
      kind: 'file',
      ownStatus: makeStatus({
        coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 },
      }),
    });
    const untracked = makeNode({
      relativePath: 'src/untracked.ts',
      kind: 'file',
    });
    const folder = makeNode({
      relativePath: 'src',
      kind: 'folder',
      children: [tracked, untracked],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 1 } }),
    });
    tracked.parent = folder;
    untracked.parent = folder;

    const result = projectTreeFromSnapshot(folder, { scope: 'all' });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].children?.length, 2);
  });
});

// ─── test: projected shape invariants ─────────────────────────────────────────

suite('projected node shape', () => {
  test('includes all expected fields for a tracked node with cognition', () => {
    const status = makeStatus();
    const node = makeNode({
      relativePath: 'src/main.ts',
      kind: 'file',
      ownStatus: status,
      status,
      cognitionUri: { scheme: 'file', authority: '', path: '/workspace/.coggit/cognition/src/main.ts.md', query: '', fragment: '' },
      description: 'Entry point',
    });
    const result = projectTreeFromSnapshot(node);
    const projected = result[0];

    assert.strictEqual(projected.path, 'src/main.ts');
    assert.strictEqual(projected.label, 'main.ts');
    assert.strictEqual(projected.kind, 'file');
    assert.strictEqual(projected.cognition, 'src/main.ts.md');
    assert.strictEqual(projected.description, 'Entry point');
    assert.strictEqual(projected.observedStatus, 'fresh');
    assert.strictEqual(projected.ownObservedStatus, 'fresh');
    assert.strictEqual(projected.tracked, true);
    assert.strictEqual(projected.children, undefined);
  });

  test('includes only path/label/kind for an untracked node with no extras', () => {
    const node = makeNode({ relativePath: 'src/unknown.ts', kind: 'file' });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });
    const projected = result[0];

    assert.strictEqual(projected.path, 'src/unknown.ts');
    assert.strictEqual(projected.label, 'unknown.ts');
    assert.strictEqual(projected.kind, 'file');
    // Optional fields should be undefined when not provided
    assert.strictEqual(projected.cognition, undefined);
    assert.strictEqual(projected.description, undefined);
    assert.strictEqual(projected.tracked, false);
    assert.strictEqual(projected.observedStatus, null);
    assert.strictEqual(projected.ownObservedStatus, null);
  });

  test('observedStatus is null when node has no status', () => {
    const node = makeNode({ relativePath: 'src/main.ts', kind: 'file' });
    const result = projectTreeFromSnapshot(node, { scope: 'all' });
    assert.strictEqual(result[0].observedStatus, null);
    assert.strictEqual(result[0].ownObservedStatus, null);
  });

  test('projected tree is JSON-serializable', () => {
    const child = makeNode({ relativePath: 'src/core', kind: 'folder', parent: undefined as unknown as CoggitTreeNode });
    const root = makeNode({
      relativePath: '.',
      kind: 'root',
      children: [child],
      status: makeStatus({ coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 } }),
    });
    child.parent = root;

    const result = projectTreeFromSnapshot(root);

    // Should not throw — JSON.stringify on circular references would throw
    assert.doesNotThrow(() => {
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as TreeProjectionNode[];
      assert.strictEqual(parsed.length, 1);
      assert.strictEqual(parsed[0].path, '.');
    });
  });
});

suite('applyTreeDepth', () => {
  test('marks the concrete node whose children were omitted', () => {
    interface TestTreeNode {
      path: string;
      truncated?: boolean;
      omittedChildrenCount?: number;
      children?: TestTreeNode[];
    }
    const nodes: TestTreeNode[] = [{
      path: 'src',
      children: [{
        path: 'src/core',
        children: [{ path: 'src/core/status.ts' }],
      }],
    }];
    const result = applyTreeDepth(nodes, 1);

    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.omittedChildrenCount, 1);
    assert.deepStrictEqual(result.nodes, [{
      path: 'src',
      children: [{
        path: 'src/core',
        truncated: true,
        omittedChildrenCount: 1,
      }],
    }]);
  });
});
