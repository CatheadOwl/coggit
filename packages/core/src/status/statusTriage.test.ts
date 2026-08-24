import * as assert from 'node:assert';

import type { UriComponents } from '../interfaces';
import type {
  CoggitNodeKind,
  CoggitTreeNode,
  CoggitWorkspaceRoot,
  NodeStatusResult,
  StatusIssue,
} from '../types';
import { inspectNodeStatus } from './index';
import { projectStatusTriage } from './statusTriage';
import {
  SYNC_COGNITION_ACTION_LABEL,
  SYNC_FOLDER_README_ACTION_LABEL,
} from './evidence';

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

function makeRoot(): CoggitWorkspaceRoot {
  return {
    id: 'root',
    label: 'root',
    workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
    configUri: uri('/workspace/.coggit/config.yaml'),
    projectRootUri: uri('/workspace'),
    sourceRootUri: uri('/workspace/src'),
    cognitionRootUri: uri('/workspace/cognition'),
  };
}

function staleIssue(label: string): StatusIssue {
  return {
    diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' },
    actions: [{ label }],
  };
}

function presentCoverage(): NodeStatusResult['coverage'] {
  return { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 0, coveredCount: 1 };
}

interface MakeNodeInput {
  id: string;
  kind: CoggitNodeKind;
  relativePath: string;
  ownStatus?: NodeStatusResult;
  cognitionPath?: string;
  children?: CoggitTreeNode[];
}

function makeNode(input: MakeNodeInput): CoggitTreeNode {
  const cognitionUri = input.cognitionPath !== undefined
    ? uri(`/workspace/cognition/${input.cognitionPath}`)
    : undefined;
  return {
    id: input.id,
    kind: input.kind,
    label: input.relativePath,
    resourceUri: uri(`/workspace/src/${input.relativePath}`),
    sourceUri: uri(`/workspace/src/${input.relativePath}`),
    ...(cognitionUri ? { cognitionUri } : {}),
    relativePath: input.relativePath,
    ...(input.ownStatus ? { ownStatus: input.ownStatus, status: input.ownStatus } : {}),
    contextValue: 'node',
    ...(input.children ? { children: input.children } : {}),
    root: makeRoot(),
  };
}

function staleFileNode(id: string, relativePath: string): CoggitTreeNode {
  return makeNode({
    id,
    kind: 'file',
    relativePath,
    cognitionPath: `${relativePath}.md`,
    ownStatus: {
      observedStatus: 'stale',
      ownObservedStatus: 'stale',
      issues: [staleIssue(SYNC_COGNITION_ACTION_LABEL)],
      coverage: presentCoverage(),
      computedAt: 1,
    },
  });
}

function freshRoot(children: CoggitTreeNode[]): CoggitTreeNode {
  return makeNode({
    id: '.',
    kind: 'root',
    relativePath: '.',
    cognitionPath: 'README.md',
    ownStatus: {
      observedStatus: 'fresh',
      ownObservedStatus: 'fresh',
      issues: [],
      coverage: presentCoverage(),
      computedAt: 1,
    },
    children,
  });
}

suite('status subtree triage', () => {
  test('groups a stale file descendant into the ordered sync-then-resolve pair', () => {
    const root = freshRoot([staleFileNode('src/stale.ts', 'src/stale.ts')]);

    const inspection = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    // The descendant-scoped pair never leaks into the top-level channel: the
    // maintained-filter echo of the sync label stays label-only there.
    assert.ok(inspection.suggestedActions.every(
      (action) => action.operation === undefined && action.handbookId === undefined,
    ));

    assert.deepStrictEqual(inspection.triage, [{
      sourcePath: 'src/stale.ts',
      cognitionPath: 'src/stale.ts.md',
      nodeKind: 'file',
      relation: 'descendant',
      issues: [{
        nodeId: 'src/stale.ts',
        nodeKind: 'file',
        sourceUri: uri('/workspace/src/src/stale.ts'),
        cognitionUri: uri('/workspace/cognition/src/stale.ts.md'),
        cognitionPath: 'src/stale.ts.md',
        relativePath: 'src/stale.ts',
        hasPairedCognition: true,
        issue: staleIssue(SYNC_COGNITION_ACTION_LABEL),
      }],
      actions: [{
        code: 'sync-cognition-with-source',
        label: SYNC_COGNITION_ACTION_LABEL,
        handbookId: 'leaf',
        sourcePath: 'src/stale.ts',
      }, {
        code: 'resolve-stale-cognition',
        label: 'After syncing, accept the pair as reviewed',
        operation: 'resolve',
        sourcePath: 'src/stale.ts',
      }],
    }]);
  });

  test('keeps the own entry facts-only when the inspected node also has issues', () => {
    const staleRoot = makeNode({
      id: '.',
      kind: 'root',
      relativePath: '.',
      cognitionPath: 'README.md',
      ownStatus: {
        observedStatus: 'stale',
        ownObservedStatus: 'stale',
        issues: [staleIssue(SYNC_FOLDER_README_ACTION_LABEL)],
        coverage: presentCoverage(),
        computedAt: 1,
      },
      children: [staleFileNode('src/stale.ts', 'src/stale.ts')],
    });

    const inspection = inspectNodeStatus({
      node: staleRoot,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    assert.strictEqual(inspection.triage.length, 2);
    const [own, descendant] = inspection.triage;
    // Own entry leads and is facts-only: its next steps stay exclusively in
    // the top-level suggestedActions channel.
    assert.strictEqual(own.relation, 'own');
    assert.deepStrictEqual(own.actions, []);
    assert.ok(inspection.suggestedActions.some(
      (action) => action.operation === 'resolve' && action.sourcePath === '.',
    ));
    // The descendant entry carries its own re-scoped pair.
    assert.strictEqual(descendant.relation, 'descendant');
    assert.deepStrictEqual(descendant.actions.map((action) => action.sourcePath), ['src/stale.ts', 'src/stale.ts']);
  });

  test('maps a stale folder descendant to the skeleton handbook and folder sync label', () => {
    const staleFolder = makeNode({
      id: 'src/feature',
      kind: 'folder',
      relativePath: 'src/feature',
      cognitionPath: 'src/feature/README.md',
      ownStatus: {
        observedStatus: 'stale',
        ownObservedStatus: 'stale',
        issues: [staleIssue(SYNC_FOLDER_README_ACTION_LABEL)],
        coverage: presentCoverage(),
        computedAt: 1,
      },
    });
    const root = freshRoot([staleFolder]);

    const inspection = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    const entry = inspection.triage[0];
    assert.strictEqual(entry.nodeKind, 'folder');
    assert.deepStrictEqual(entry.actions[0], {
      code: 'sync-cognition-with-source',
      label: SYNC_FOLDER_README_ACTION_LABEL,
      handbookId: 'skeleton',
      sourcePath: 'src/feature',
    });
  });

  test('synthesizes no operation or handbook actions for error nodes', () => {
    const errorNode = makeNode({
      id: 'src/broken',
      kind: 'error',
      relativePath: 'src/broken',
      ownStatus: {
        issues: [{
          diagnostic: { code: 'source-deleted', severity: 'error', message: 'Source was deleted.' },
          actions: [{ label: 'Remove the orphan cognition.' }],
        }],
        coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
        computedAt: 1,
      },
    });
    const root = freshRoot([errorNode]);

    const inspection = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    const entry = inspection.triage[0];
    assert.strictEqual(entry.nodeKind, 'error');
    // Error nodes carry no synthesized workflow actions; the issue's label
    // guidance stays in entry.issues[].suggestedActions, not in the action
    // channel.
    assert.deepStrictEqual(entry.actions, []);
    assert.deepStrictEqual(entry.issues[0].issue.actions, [{ label: 'Remove the orphan cognition.' }]);
  });

  test('synthesizes add for a missing-cognition descendant only under all visibility', () => {
    const missingNode = makeNode({
      id: 'src/missing.ts',
      kind: 'file',
      relativePath: 'src/missing.ts',
      cognitionPath: 'src/missing.ts.md',
      ownStatus: {
        issues: [{
          diagnostic: { code: 'missing-cognition', severity: 'warning', message: 'Cognition is missing.' },
          actions: [{ label: 'Create cognition file' }],
        }],
        coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
        computedAt: 1,
      },
    });
    const root = freshRoot([missingNode]);

    const maintained = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });
    assert.deepStrictEqual(maintained.triage, []);

    const all = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
      issueVisibility: 'all',
    });
    assert.strictEqual(all.triage.length, 1);
    assert.deepStrictEqual(all.triage[0].actions[0], {
      code: 'create-cognition',
      label: 'Create cognition file',
      operation: 'add',
      sourcePath: 'src/missing.ts',
    });
  });

  test('projectStatusTriage maps synthesized facts into the adapter-ready view', () => {
    const root = freshRoot([staleFileNode('src/stale.ts', 'src/stale.ts')]);
    const inspection = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    const view = projectStatusTriage(inspection);

    assert.strictEqual(view.sourcePath, '.');
    assert.strictEqual(view.issueCount, 1);
    assert.strictEqual(view.entries.length, 1);
    const entry = view.entries[0];
    assert.strictEqual(entry.relation, 'descendant');
    // Issues reuse the serializable presentation shape.
    assert.deepStrictEqual(entry.issues, [{
      sourcePath: 'src/stale.ts',
      cognitionPath: 'src/stale.ts.md',
      severity: 'warning',
      message: 'Stale cognition.',
      suggestedActions: [SYNC_COGNITION_ACTION_LABEL],
    }]);
    // Actions are copied from the synthesized entry, in order.
    assert.deepStrictEqual(entry.suggestedActions.map((action) => action.code), [
      'sync-cognition-with-source',
      'resolve-stale-cognition',
    ]);
  });

  test('projectStatusTriage returns an empty view for an issue-free hit', () => {
    const root = freshRoot([]);
    const inspection = inspectNodeStatus({
      node: root,
      sourcePath: '.',
      cognitionPath: 'README.md',
      handbookId: 'skeleton',
    });

    assert.deepStrictEqual(projectStatusTriage(inspection), {
      sourcePath: '.',
      issueCount: 0,
      entries: [],
    });
  });
});
