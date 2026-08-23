import * as assert from 'node:assert';
import { z } from 'zod';

import type {
  AddOperationResult,
  CoggitProjectContext,
  ResolveOperationResult,
  RoutesOperationResult,
  SnapshotOperationResult,
  StatusOperationResult,
} from '@coggit/core';
import { selectRoutesBySourcePath } from '@coggit/core';
import { applyRoutesFilters, suggestRoutePathHints } from '@coggit/core/internal';
import type { TreeProjectionNode } from '@coggit/core/internal';
import { clipboardNodeStatusText } from '@coggit/format';
import {
  addOperationOutputSchema,
  addStructuredContent,
  routesOperationOutputSchema,
  routesStructuredContent,
  handbookUri,
  resolveOperationOutputSchema,
  resolveStructuredContent,
  snapshotMcpView,
  snapshotOperationOutputSchema,
  snapshotStructuredContent,
  statusMcpView,
  statusOperationOutputSchema,
  statusStructuredContent,
} from './operationDto/index.js';

suite('mcp operation DTO adapter', () => {
  const project: CoggitProjectContext = {
    label: 'fixture',
    configUri: 'file:///workspace/.coggit/config.yaml',
    projectRootUri: 'file:///workspace',
    sourceRootUri: 'file:///workspace/src',
    cognitionRootUri: 'file:///workspace/codebase_cognition',
    sourceRoot: 'src',
    cognitionRoot: 'codebase_cognition',
    sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
  };

  test('status structured content maps handbook id to handbook URI', () => {
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/main.ts',
      nodeKind: 'file',
      project: null,
      cognitionPath: 'src/main.ts.md',
      status: 'fresh',
      ownStatus: 'fresh',
      descendantStatus: null,
      staleAction: null,
      issueCount: 0,
      ownIssueCount: 0,
      descendantIssueCount: 0,
      issues: [],
      suggestedActions: [],
      handbookId: 'leaf',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/main.ts',
        cognitionPath: 'src/main.ts.md',
        cognitionPresence: 'present',
        nodeKind: 'file',
        status: 'fresh',
        ownStatus: 'fresh',
        descendantStatus: null,
        issueSummary: { total: 0, own: 0, descendant: 0 },
        subtreeIssues: { own: [], descendant: [] },
        suggestedActions: [],
        triage: [],
        handbookId: 'leaf',
      },
    };

    assert.strictEqual(statusStructuredContent(statusMcpView(result)).handbookUri, 'coggit://handbook/leaf');
    assert.deepStrictEqual(statusStructuredContent(statusMcpView(result)).nextActions, [{
      code: 'read-handbook-before-maintenance',
      label: 'If maintaining this cognition, read the matching handbook before editing.',
      kind: 'read-resource',
      priority: 1,
      resourceUri: 'coggit://handbook/leaf',
    }]);
  });

  test('status stale hit maps the ordered handbook-then-resolve actions and suppresses the duplicate top-level handbook action', () => {
    const staleActions = [{
      code: 'sync-cognition-with-source',
      label: 'Sync cognition with source changes',
      handbookId: 'leaf' as const,
      sourcePath: 'src/stale.ts',
    }, {
      code: 'resolve-stale-cognition',
      label: 'After syncing, accept the pair as reviewed',
      operation: 'resolve' as const,
      sourcePath: 'src/stale.ts',
    }];
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/stale.ts',
      nodeKind: 'file',
      project: null,
      cognitionPath: 'src/stale.ts.md',
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      staleAction: 'align-cognition-first',
      issueCount: 1,
      ownIssueCount: 1,
      descendantIssueCount: 0,
      issues: [],
      suggestedActions: staleActions,
      handbookId: 'leaf',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/stale.ts',
        cognitionPath: 'src/stale.ts.md',
        cognitionPresence: 'present',
        nodeKind: 'file',
        status: 'stale',
        ownStatus: 'stale',
        descendantStatus: null,
        issueSummary: { total: 1, own: 1, descendant: 0 },
        subtreeIssues: { own: [], descendant: [] },
        suggestedActions: staleActions,
        triage: [],
        handbookId: 'leaf',
      },
    };

    const structuredContent = statusStructuredContent(statusMcpView(result));

    // Action-level handbookId maps to the handbook resource URI exactly as the
    // top-level field does; array order keeps the authoring hint first.
    assert.deepStrictEqual(structuredContent.suggestedActions, [{
      code: 'sync-cognition-with-source',
      label: 'Sync cognition with source changes',
      handbookUri: 'coggit://handbook/leaf',
      sourcePath: 'src/stale.ts',
    }, {
      code: 'resolve-stale-cognition',
      label: 'After syncing, accept the pair as reviewed',
      tool: 'coggit_resolve',
      sourcePath: 'src/stale.ts',
    }]);
    // The ordered list is the source of truth for stale maintenance: the
    // top-level read-before-edit entry is suppressed, not duplicated.
    assert.deepStrictEqual(structuredContent.nextActions, []);

    assert.deepStrictEqual(
      z.object(statusOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('status triage maps descendant actions and never widens the top-level handbook suppression', () => {
    const descendantActions = [{
      code: 'sync-cognition-with-source',
      label: 'Sync cognition with source changes',
      handbookId: 'leaf' as const,
      sourcePath: 'src/app/main.ts',
    }, {
      code: 'resolve-stale-cognition',
      label: 'After syncing, accept the pair as reviewed',
      operation: 'resolve' as const,
      sourcePath: 'src/app/main.ts',
    }];
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/app',
      nodeKind: 'folder',
      project: null,
      cognitionPath: 'src/app/README.md',
      status: 'stale',
      ownStatus: 'fresh',
      descendantStatus: 'stale',
      staleAction: null,
      issueCount: 1,
      ownIssueCount: 0,
      descendantIssueCount: 1,
      issues: [],
      // All descendant actions stay in the triage channel; top-level
      // suggestedActions is empty for descendant-only stale.
      suggestedActions: [],
      handbookId: 'skeleton',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/app',
        cognitionPath: 'src/app/README.md',
        cognitionPresence: 'present',
        nodeKind: 'folder',
        status: 'stale',
        ownStatus: 'fresh',
        descendantStatus: 'stale',
        issueSummary: { total: 1, own: 0, descendant: 1 },
        subtreeIssues: { own: [], descendant: [] },
        suggestedActions: [],
        triage: [{
          sourcePath: 'src/app/main.ts',
          cognitionPath: 'src/app/main.ts.md',
          nodeKind: 'file',
          relation: 'descendant',
          issues: [],
          actions: descendantActions,
        }],
        handbookId: 'skeleton',
      },
    };

    const structuredContent = statusStructuredContent(statusMcpView(result));

    // The triage entry maps node-scoped actions to MCP addressing exactly as
    // top-level actions are mapped.
    assert.deepStrictEqual(structuredContent.triage, {
      sourcePath: 'src/app',
      issueCount: 1,
      entries: [{
        sourcePath: 'src/app/main.ts',
        cognitionPath: 'src/app/main.ts.md',
        nodeKind: 'file',
        relation: 'descendant',
        issues: [],
        suggestedActions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookUri: 'coggit://handbook/leaf',
          sourcePath: 'src/app/main.ts',
        }, {
          code: 'resolve-stale-cognition',
          label: 'After syncing, accept the pair as reviewed',
          tool: 'coggit_resolve',
          sourcePath: 'src/app/main.ts',
        }],
      }],
    });
    // The suppression key only scans top-level suggestedActions, so the
    // descendant handbook action must not suppress the inspected folder's own
    // top-level read-before-edit fallback.
    assert.strictEqual(structuredContent.nextActions.length, 1);
    assert.strictEqual(structuredContent.nextActions[0].resourceUri, 'coggit://handbook/skeleton');

    assert.deepStrictEqual(
      z.object(statusOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('status keeps the top-level handbook next action when no step-local handbook action exists', () => {
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/fresh.ts',
      nodeKind: 'file',
      project: null,
      cognitionPath: 'src/fresh.ts.md',
      status: 'fresh',
      ownStatus: 'fresh',
      descendantStatus: null,
      staleAction: null,
      issueCount: 0,
      ownIssueCount: 0,
      descendantIssueCount: 0,
      issues: [],
      suggestedActions: [],
      handbookId: 'skeleton',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/fresh.ts',
        cognitionPath: 'src/fresh.ts.md',
        cognitionPresence: 'present',
        nodeKind: 'file',
        status: 'fresh',
        ownStatus: 'fresh',
        descendantStatus: null,
        issueSummary: { total: 0, own: 0, descendant: 0 },
        subtreeIssues: { own: [], descendant: [] },
        suggestedActions: [],
        triage: [],
        handbookId: 'skeleton',
      },
    };

    assert.deepStrictEqual(statusStructuredContent(statusMcpView(result)).nextActions, [{
      code: 'read-handbook-before-maintenance',
      label: 'If maintaining this cognition, read the matching handbook before editing.',
      kind: 'read-resource',
      priority: 1,
      resourceUri: 'coggit://handbook/skeleton',
    }]);
  });

  test('add structured content preserves typed failure details', () => {
    const result: AddOperationResult = {
      success: false,
      created: null,
      kind: null,
      sourcePath: 'missing.ts',
      cognitionPath: null,
      project: null,
      handbookId: null,
      suggestedActions: [],
      error: {
        code: 'path-not-found',
        message: 'Path not found in any CogGit project.',
      },
      pathHints: [],
    };

    assert.deepStrictEqual(addStructuredContent(result).error, result.error);
    assert.strictEqual(addStructuredContent(result).handbookUri, null);
    assert.deepStrictEqual(addStructuredContent(result).nextActions, []);
  });

  test('add structured content omits fuzzy hint fields when there are no hints', () => {
    const result: AddOperationResult = {
      success: false,
      created: null,
      kind: null,
      sourcePath: 'missing.ts',
      cognitionPath: null,
      project: null,
      handbookId: null,
      suggestedActions: [],
      error: {
        code: 'path-not-found',
        message: 'Path not found in any CogGit project.',
      },
      pathHints: [],
    };

    const structuredContent = addStructuredContent(result);

    // The optional miss/hint prose keys are only present when core supplies
    // them, so a miss with no hints stays lean and schema-conformant.
    assert.strictEqual('pathMissMessage' in structuredContent, false);
    assert.strictEqual('pathHintMessage' in structuredContent, false);
    assert.deepStrictEqual(
      z.object(addOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('add structured content carries fuzzy path hints for a miss', () => {
    const result: AddOperationResult = {
      success: false,
      created: null,
      kind: null,
      sourcePath: 'registry',
      cognitionPath: null,
      project: null,
      handbookId: null,
      suggestedActions: [],
      error: {
        code: 'path-not-found',
        message: 'Path not found in any CogGit project.',
      },
      pathHints: ['src/registry.ts'],
      pathMissMessage: 'Path not found in any CogGit project: registry',
      pathHintMessage: 'You may mean one of these source-root-relative source paths.',
    };

    const structuredContent = addStructuredContent(result);

    assert.deepStrictEqual(structuredContent.pathHints, ['src/registry.ts']);
    assert.strictEqual(structuredContent.pathMissMessage, 'Path not found in any CogGit project: registry');
    assert.strictEqual(
      structuredContent.pathHintMessage,
      'You may mean one of these source-root-relative source paths.',
    );
    assert.deepStrictEqual(
      z.object(addOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('resolve structured content conforms to the resolve output schema', () => {
    const result: ResolveOperationResult = {
      success: true,
      sourcePath: 'src/app',
      cognitionPath: 'src/app/README.md',
      project,
      sourceKey: 'src/app/',
      verificationTimeMs: 1710000000000,
      suggestedActions: [],
      error: null,
      pathHints: [],
    };

    const structuredContent = resolveStructuredContent(result);

    assert.deepStrictEqual(
      z.object(resolveOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.deepStrictEqual(structuredContent.project, {
      label: 'fixture',
      projectRoot: '/workspace',
      sourceRoot: 'src',
      cognitionRoot: 'codebase_cognition',
      sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
    });
    assert.deepStrictEqual(structuredContent.nextActions, []);
  });

  test('snapshot structured content returns lean tree with scope', () => {
    const result: SnapshotOperationResult = {
      scope: 'tracked',
      projectCount: 1,
      trackedCount: 1,
      untrackedCount: 0,
      issueCount: 0,
      nextScopes: [],
      maxDepth: 2,
      truncated: true,
      omittedChildrenCount: 3,
      suggestedActions: [{
        code: 'diagnose-source-path',
        label: 'Diagnose this source path before explaining or editing it.',
        operation: 'status',
        sourcePath: 'src',
      }],
      projects: [],
      sourcePath: 'src',
      found: true,
      snapshot: null,
      node: null,
      pathHints: [],
    };

    const tree: TreeProjectionNode[] = [{ path: 'src/main.ts', label: 'main.ts', kind: 'file' }];
    const view = snapshotMcpView(result, { tree });
    const structuredContent = snapshotStructuredContent(view);

    assert.deepStrictEqual(structuredContent, {
      scope: 'tracked',
      tree: [{ path: 'src/main.ts' }],
      meta: {
        found: true,
        sourcePath: 'src',
        projectCount: 1,
        trackedCount: 1,
        untrackedCount: 0,
        issueCount: 0,
        maxDepth: 2,
        truncated: true,
        omittedChildrenCount: 3,
      },
      projects: [],
      nextScopes: [],
      suggestedActions: [{
        code: 'diagnose-source-path',
        label: 'Diagnose this source path before explaining or editing it.',
        tool: 'coggit_status',
        sourcePath: 'src',
      }],
      pathHints: [],
    });
  });

  test('snapshot structured content conforms to lean output schema', () => {
    const result: SnapshotOperationResult = {
      scope: 'issues',
      projectCount: 1,
      trackedCount: 2,
      untrackedCount: 1,
      issueCount: 1,
      nextScopes: ['untracked'],
      maxDepth: 1,
      truncated: true,
      omittedChildrenCount: 2,
      suggestedActions: [{
        code: 'inspect-untracked',
        label: 'Inspect source paths missing paired cognition.',
        operation: 'snapshot',
        sourcePath: 'src',
        scope: 'untracked',
        maxDepth: 1,
      }],
      projects: [project],
      sourcePath: 'src',
      found: true,
      snapshot: null,
      node: null,
      pathHints: [],
    };

    const tree: TreeProjectionNode[] = [{
      path: 'src/main.ts',
      label: 'main.ts',
      kind: 'file',
      tracked: false,
      observedStatus: null,
      ownObservedStatus: null,
    }];
    const view = snapshotMcpView(result, { tree });
    const structuredContent = snapshotStructuredContent(view);

    assert.deepStrictEqual(
      z.object(snapshotOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.deepStrictEqual(structuredContent.tree, [
      { path: 'src/main.ts', observedStatus: null },
    ]);
    assert.deepStrictEqual(structuredContent.meta, {
      found: true,
      sourcePath: 'src',
      projectCount: 1,
      trackedCount: 2,
      untrackedCount: 1,
      issueCount: 1,
      maxDepth: 1,
      truncated: true,
      omittedChildrenCount: 2,
    });
    assert.deepStrictEqual(structuredContent.projects, [{
      label: 'fixture',
      projectRoot: '/workspace',
      sourceRoot: 'src',
      cognitionRoot: 'codebase_cognition',
      sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
    }]);
    assert.deepStrictEqual(structuredContent.nextScopes, ['untracked']);
    assert.deepStrictEqual(structuredContent.suggestedActions, [{
      code: 'inspect-untracked',
      label: 'Inspect source paths missing paired cognition.',
      tool: 'coggit_snapshot',
      sourcePath: 'src',
      scope: 'untracked',
      maxDepth: 1,
    }]);
    assert.strictEqual('configUri' in structuredContent.projects[0], false);
  });

  test('status structured content conforms to output schema', () => {
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/main.ts',
      nodeKind: 'file',
      project,
      cognitionPath: 'src/main.ts.md',
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      staleAction: 'align-cognition-first',
      issueCount: 1,
      ownIssueCount: 1,
      descendantIssueCount: 0,
      issues: [{
        relativePath: 'src/main.ts',
        severity: 'warning',
        code: 'missing-cognition',
        message: 'Cognition is missing.',
        actions: [{
          code: 'add-cognition',
          label: 'Create paired cognition for this source path.',
          operation: 'add',
          sourcePath: 'src/main.ts',
        }],
      }],
      suggestedActions: [{
        code: 'add-cognition',
        label: 'Create paired cognition for this source path.',
        operation: 'add',
        sourcePath: 'src/main.ts',
      }],
      handbookId: 'leaf',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/main.ts',
        cognitionPath: 'src/main.ts.md',
        cognitionPresence: 'missing',
        nodeKind: 'file',
        status: 'stale',
        ownStatus: 'stale',
        descendantStatus: null,
        issueSummary: { total: 1, own: 1, descendant: 0 },
        subtreeIssues: {
          own: [{
            nodeId: 'src/main.ts',
            nodeKind: 'file',
            sourceUri: { scheme: 'file', authority: '', path: '/workspace/src/src/main.ts', query: '', fragment: '' },
            cognitionPath: 'src/main.ts.md',
            relativePath: 'src/main.ts',
            issue: {
              diagnostic: {
                code: 'missing-cognition',
                severity: 'warning',
                message: 'Cognition is missing.',
              },
              actions: [{ label: 'Create paired cognition for this source path.' }],
            },
          }],
          descendant: [],
        },
        suggestedActions: [{
          code: 'add-cognition',
          label: 'Create paired cognition for this source path.',
          operation: 'add',
          sourcePath: 'src/main.ts',
        }],
        triage: [],
        handbookId: 'leaf',
      },
    };

    const view = statusMcpView(result);
    const structuredContent = statusStructuredContent(view);

    assert.strictEqual(structuredContent.ownIssues.length, 1);
    assert.strictEqual(structuredContent.cognitionPresence, 'missing');
    assert.strictEqual(structuredContent.ownIssues[0].sourcePath, 'src/main.ts');
    assert.strictEqual(structuredContent.ownIssues[0].cognitionPath, 'src/main.ts.md');
    assert.strictEqual(structuredContent.ownIssues[0].severity, 'warning');
    assert.strictEqual(structuredContent.ownIssues[0].message, 'Cognition is missing.');
    assert.deepStrictEqual(structuredContent.ownIssues[0].suggestedActions, [
      'Create paired cognition for this source path.',
    ]);
    assert.strictEqual(structuredContent.descendantIssues.length, 0);
    assert.strictEqual(structuredContent.handbookUri, 'coggit://handbook/leaf');
    assert.deepStrictEqual(structuredContent.nextActions, [{
      code: 'read-handbook-before-maintenance',
      label: 'If maintaining this cognition, read the matching handbook before editing.',
      kind: 'read-resource',
      priority: 1,
      resourceUri: 'coggit://handbook/leaf',
    }]);
    assert.deepStrictEqual(structuredContent.suggestedActions, [{
      code: 'add-cognition',
      label: 'Create paired cognition for this source path.',
      tool: 'coggit_add',
      sourcePath: 'src/main.ts',
    }]);

    assert.deepStrictEqual(
      z.object(statusOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('status MCP view keeps structured facts aligned with current fallback text facts', () => {
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/app',
      nodeKind: 'folder',
      project,
      cognitionPath: 'src/app/README.md',
      status: 'conflict',
      ownStatus: 'fresh',
      descendantStatus: 'conflict',
      staleAction: 'align-cognition-first',
      issueCount: 2,
      ownIssueCount: 1,
      descendantIssueCount: 1,
      issues: [],
      suggestedActions: [],
      handbookId: 'skeleton',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/app',
        cognitionPath: 'src/app/README.md',
        cognitionPresence: 'present',
        nodeKind: 'folder',
        status: 'conflict',
        ownStatus: 'fresh',
        descendantStatus: 'conflict',
        issueSummary: { total: 2, own: 1, descendant: 1 },
        subtreeIssues: {
          own: [{
            nodeId: 'src/app',
            nodeKind: 'folder',
            sourceUri: { scheme: 'file', authority: '', path: '/workspace/src/src/app', query: '', fragment: '' },
            cognitionUri: { scheme: 'file', authority: '', path: '/workspace/codebase_cognition/src/app/README.md', query: '', fragment: '' },
            cognitionPath: 'src/app/README.md',
            relativePath: 'src/app',
            issue: {
              diagnostic: {
                code: 'folder-structure-changed',
                severity: 'warning',
                message: 'Folder structure changed.',
              },
              actions: [{ label: 'Update folder cognition structure.' }],
            },
          }],
          descendant: [{
            nodeId: 'src/app/main.ts',
            nodeKind: 'file',
            sourceUri: { scheme: 'file', authority: '', path: '/workspace/src/src/app/main.ts', query: '', fragment: '' },
            cognitionUri: { scheme: 'file', authority: '', path: '/workspace/codebase_cognition/src/app/main.ts.md', query: '', fragment: '' },
            cognitionPath: 'src/app/main.ts.md',
            relativePath: 'src/app/main.ts',
            issue: {
              diagnostic: {
                code: 'conflicting-evidence',
                severity: 'error',
                message: 'Conflicting evidence.',
              },
              actions: [{ label: 'Resolve conflicting evidence.' }],
            },
          }],
        },
        suggestedActions: [],
        triage: [],
        handbookId: 'skeleton',
      },
    };

    const structuredContent = statusStructuredContent(statusMcpView(result));
    const text = clipboardNodeStatusText(result.inspection!);

    assert.match(text, /^Status: Conflict\nSource: src\/app\nCognition: src\/app\/README\.md/);
    assert.match(text, /\n\nOwn issues: 1\n- src\/app: \[warning\] Folder structure changed\. Suggested actions: Update folder cognition structure\./);
    assert.match(text, /\n\nDescendant issues: 1\n- src\/app\/main\.ts: \[error\] Conflicting evidence\. Suggested actions: Resolve conflicting evidence\./);
    assert.strictEqual(structuredContent.sourcePath, 'src/app');
    assert.strictEqual(structuredContent.cognitionPath, 'src/app/README.md');
    assert.strictEqual(structuredContent.status, 'conflict');
    assert.strictEqual(structuredContent.ownStatus, 'fresh');
    assert.strictEqual(structuredContent.descendantStatus, 'conflict');
    assert.strictEqual(structuredContent.ownIssues.length, 1);
    assert.strictEqual(structuredContent.descendantIssues.length, 1);
    assert.strictEqual(structuredContent.ownIssues[0].sourcePath, 'src/app');
    assert.strictEqual(structuredContent.descendantIssues[0].sourcePath, 'src/app/main.ts');
    assert.strictEqual(structuredContent.nextActions[0].code, 'read-handbook-before-maintenance');
    assert.strictEqual(structuredContent.nextActions[0].resourceUri, 'coggit://handbook/skeleton');
  });

  test('status structured content carries fuzzy path hints for a miss', () => {
    const result: StatusOperationResult = {
      found: false,
      sourcePath: 'src/core/watchPipeline.ts',
      nodeKind: null,
      project: null,
      cognitionPath: null,
      status: null,
      ownStatus: null,
      descendantStatus: null,
      staleAction: null,
      issueCount: 1,
      ownIssueCount: 0,
      descendantIssueCount: 0,
      issues: [],
      suggestedActions: [],
      handbookId: null,
      node: null,
      pathHints: ['coggit/src/core/watchPipeline.ts'],
      pathMissMessage: 'Path not found in any CogGit project: src/core/watchPipeline.ts',
      pathHintMessage: 'You may mean one of these source-root-relative source paths.',
    };

    const structuredContent = statusStructuredContent(statusMcpView(result));

    assert.deepStrictEqual(structuredContent.pathHints, ['coggit/src/core/watchPipeline.ts']);
    assert.strictEqual(structuredContent.pathMissMessage, 'Path not found in any CogGit project: src/core/watchPipeline.ts');
    assert.strictEqual(structuredContent.pathHintMessage, 'You may mean one of these source-root-relative source paths.');
    assert.deepStrictEqual(
      z.object(statusOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
  });

  test('add structured content conforms to output schema', () => {
    const result: AddOperationResult = {
      success: true,
      created: true,
      kind: 'leaf',
      sourcePath: 'src/main.ts',
      cognitionPath: 'src/main.ts.md',
      project,
      handbookId: 'leaf',
      suggestedActions: [],
      error: null,
      pathHints: [],
    };

    const structuredContent = addStructuredContent(result);

    assert.deepStrictEqual(
      z.object(addOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.deepStrictEqual(structuredContent.project, {
      label: 'fixture',
      projectRoot: '/workspace',
      sourceRoot: 'src',
      cognitionRoot: 'codebase_cognition',
      sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
    });
    assert.strictEqual(structuredContent.handbookUri, 'coggit://handbook/leaf');
    assert.deepStrictEqual(structuredContent.nextActions, [{
      code: 'read-handbook-before-maintenance',
      label: 'Read the matching handbook before completing the created cognition template.',
      kind: 'read-resource',
      priority: 1,
      resourceUri: 'coggit://handbook/leaf',
    }]);
  });

  test('routes structured content defaults to a compact flat route list', () => {
    const result: RoutesOperationResult = {
      project,
      generatedAt: 1234,
      entryCount: 4,
      entries: [{
        key: 'src/core',
        projectRelativeSourcePath: 'src/src/core',
        toolSourcePath: 'src/core',
        cognitionPath: 'src/core/README.md',
        documentKind: 'folder',
        metadataType: 'reference',
        identity: {
          name: 'core',
          description: 'Core layer',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 90,
            lineCount: 9,
            nonEmptyLineCount: 7,
            contentHash: 'core',
            mtimeMs: 999,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }, {
        key: 'src/main.ts',
        projectRelativeSourcePath: 'src/src/main.ts',
        toolSourcePath: 'src/main.ts',
        cognitionPath: 'src/main.ts.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'main',
          description: 'Main module',
          retrievalSummary: 'Route main module questions.',
          retrievalIntents: ['main'],
          tags: ['core'],
        },
        document: {
          metrics: {
            charLength: 100,
            lineCount: 10,
            nonEmptyLineCount: 8,
            contentHash: 'abc',
            mtimeMs: 1000,
          },
          headings: [{
            depth: 1,
            text: 'Main',
            line: 8,
            slug: 'main',
          }],
          headingCount: 1,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [{
          code: 'diagnose-source-path',
          label: 'Diagnose this source path before explaining or editing it.',
          operation: 'status',
          sourcePath: 'src/main.ts',
        }],
      }, {
        key: 'src/core/status.ts',
        projectRelativeSourcePath: 'src/src/core/status.ts',
        toolSourcePath: 'src/core/status.ts',
        cognitionPath: 'src/core/status.ts.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'status',
          description: 'Status module',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 80,
            lineCount: 8,
            nonEmptyLineCount: 6,
            contentHash: 'def',
            mtimeMs: 1001,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }, {
        key: 'outside.md',
        projectRelativeSourcePath: '../outside.md',
        toolSourcePath: null,
        cognitionPath: 'outside.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'outside',
          description: 'Outside source root',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 30,
            lineCount: 4,
            nonEmptyLineCount: 3,
            contentHash: 'ghi',
            mtimeMs: 1002,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'usable',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }],
      diagnostics: [],
      routes: {
        project,
        generatedAt: 1234,
        entries: [],
        diagnostics: [],
      },
    };

    const structuredContent = routesStructuredContent(result);

    assert.deepStrictEqual(
      z.object(routesOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.strictEqual(structuredContent.project.sourceRoot, 'src');
    assert.strictEqual(structuredContent.project.cognitionRoot, 'codebase_cognition');
    assert.strictEqual(structuredContent.depth, 2);
    assert.deepStrictEqual(structuredContent.routes, [
      'outside.md | Outside source root',
      'src/core/README.md | Core layer',
      'src/core/status.ts.md | Status module',
      'src/main.ts.md | Main module',
    ]);
    assert.strictEqual('tree' in structuredContent, false);
    assert.strictEqual('format' in structuredContent, false);
    assert.strictEqual('entries' in structuredContent, false);
    assert.strictEqual('truncated' in structuredContent, false);
    assert.strictEqual('omittedChildrenCount' in structuredContent, false);
    assert.strictEqual('limit' in structuredContent, false);
    assert.strictEqual('offset' in structuredContent, false);
  });

  test('routes structured content can expose the compact cognition route tree', () => {
    const result: RoutesOperationResult = {
      project,
      generatedAt: 1234,
      entryCount: 4,
      entries: [{
        key: 'src/core',
        projectRelativeSourcePath: 'src/src/core',
        toolSourcePath: 'src/core',
        cognitionPath: 'src/core/README.md',
        documentKind: 'folder',
        metadataType: 'reference',
        identity: {
          name: 'core',
          description: 'Core layer',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 90,
            lineCount: 9,
            nonEmptyLineCount: 7,
            contentHash: 'core',
            mtimeMs: 999,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }, {
        key: 'src/main.ts',
        projectRelativeSourcePath: 'src/src/main.ts',
        toolSourcePath: 'src/main.ts',
        cognitionPath: 'src/main.ts.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'main',
          description: 'Main module',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 100,
            lineCount: 10,
            nonEmptyLineCount: 8,
            contentHash: 'abc',
            mtimeMs: 1000,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }, {
        key: 'src/core/status.ts',
        projectRelativeSourcePath: 'src/src/core/status.ts',
        toolSourcePath: 'src/core/status.ts',
        cognitionPath: 'src/core/status.ts.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'status',
          description: 'Status module',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 80,
            lineCount: 8,
            nonEmptyLineCount: 6,
            contentHash: 'def',
            mtimeMs: 1001,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }, {
        key: 'CODE_MAP',
        projectRelativeSourcePath: null,
        toolSourcePath: null,
        cognitionPath: 'CODE_MAP.md',
        documentKind: 'leaf',
        metadataType: 'reference',
        identity: {
          name: 'code-map',
          description: 'Code map',
          retrievalSummary: null,
          retrievalIntents: [],
          tags: [],
        },
        document: {
          metrics: {
            charLength: 70,
            lineCount: 7,
            nonEmptyLineCount: 5,
            contentHash: 'codemap',
            mtimeMs: 1002,
          },
          headings: [],
          headingCount: 0,
        },
        quality: {
          metadataQuality: 'good',
          staleRisk: 'unknown',
        },
        status: {
          observedStatus: null,
          staleRisk: 'unknown',
        },
        diagnostics: [],
        suggestedActions: [],
      }],
      diagnostics: [],
      routes: {
        project,
        generatedAt: 1234,
        entries: [],
        diagnostics: [],
      },
    };

    const structuredContent = routesStructuredContent(result, { format: 'tree' });

    assert.deepStrictEqual(
      z.object(routesOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.deepStrictEqual(structuredContent.tree, [{
      path: 'CODE_MAP.md',
      cognition: 'CODE_MAP.md',
      description: 'Code map',
    }, {
      path: 'src',
      children: [{
        path: 'src/core',
        cognition: 'src/core/README.md',
        description: 'Core layer',
        children: [{
          path: 'src/core/status.ts',
          cognition: 'src/core/status.ts.md',
          description: 'Status module',
        }],
      }, {
        path: 'src/main.ts',
        cognition: 'src/main.ts.md',
        description: 'Main module',
      }],
    }]);
    assert.strictEqual('routes' in structuredContent, false);
    assert.strictEqual('format' in structuredContent, false);
  });

  test('routes structured content marks truncated branches on route nodes and flat lines', () => {
    const result: RoutesOperationResult = {
      project,
      generatedAt: 1234,
      entryCount: 0,
      entries: [],
      diagnostics: [],
      routes: {
        project,
        generatedAt: 1234,
        entries: [],
        diagnostics: [],
      },
    };
    const tree = [{
      path: 'src/core',
      cognition: 'src/core/README.md',
      description: 'Core layer',
      truncated: true,
      omittedChildrenCount: 3,
    }];

    const flatContent = routesStructuredContent(result, { tree, depth: 1 });
    assert.deepStrictEqual(flatContent.routes, [
      '[truncated: 3] src/core/README.md | Core layer',
    ]);
    assert.strictEqual('truncated' in flatContent, false);
    assert.strictEqual('omittedChildrenCount' in flatContent, false);

    const treeContent = routesStructuredContent(result, { format: 'tree', tree, depth: 1 });
    assert.deepStrictEqual(
      z.object(routesOperationOutputSchema).parse(treeContent),
      treeContent,
    );
    assert.deepStrictEqual(treeContent.tree, tree);
    assert.strictEqual('routes' in treeContent, false);
  });

  test('routes sourcePath filtering returns the selected subtree root', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
        children: [{
          path: 'coggit/src/mcp-server',
          cognition: 'coggit/src/mcp-server/README.md',
          children: [{
            path: 'coggit/src/mcp-server/mcp-tools',
            cognition: 'coggit/src/mcp-server/mcp-tools/README.md',
          }],
        }],
      }],
    }];

    assert.deepStrictEqual(applyRoutesFilters(tree, 'coggit/src/mcp-server'), [{
      path: 'coggit/src/mcp-server',
      cognition: 'coggit/src/mcp-server/README.md',
      children: [{
        path: 'coggit/src/mcp-server/mcp-tools',
        cognition: 'coggit/src/mcp-server/mcp-tools/README.md',
      }],
    }]);
  });

  test('routes sourcePath filtering normalizes configured source root prefixes', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
      }],
    }];

    assert.deepStrictEqual(applyRoutesFilters(tree, 'codebase/coggit', 'codebase'), tree);
    assert.deepStrictEqual(applyRoutesFilters(tree, '\\codebase\\coggit\\src\\', 'codebase'), [{
      path: 'coggit/src',
      cognition: 'coggit/src/README.md',
    }]);
  });

  test('routes sourcePath filtering treats dot as the route root', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
      }],
    }];

    assert.deepStrictEqual(applyRoutesFilters(tree, '.'), tree);
    assert.deepStrictEqual(applyRoutesFilters(tree, './'), tree);
    assert.deepStrictEqual(applyRoutesFilters(tree, '.\\'), tree);
  });

  test('routes sourcePath filtering preserves full paths under an unmodeled prefix', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
        children: [{
          path: 'coggit/src/mcp-server/mcp-tools',
          cognition: 'coggit/src/mcp-server/mcp-tools/README.md',
        }],
      }],
    }];

    assert.deepStrictEqual(applyRoutesFilters(tree, 'coggit/src/mcp-server'), [{
      path: 'coggit/src/mcp-server/mcp-tools',
      cognition: 'coggit/src/mcp-server/mcp-tools/README.md',
    }]);
  });

  test('routes sourcePath mismatch returns no hints without suffix matches', () => {
    const tree = [{
      path: 'core',
    }, {
      path: 'runtime/node',
    }, {
      path: 'CODE_MAP.md',
    }];

    assert.deepStrictEqual(suggestRoutePathHints(tree, 'src'), []);
    assert.deepStrictEqual(suggestRoutePathHints(tree, '.'), []);
  });

  test('routes sourcePath mismatch suggests suffix-matched src route paths first', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
        children: [{
          path: 'coggit/src/mcp-server',
          cognition: 'coggit/src/mcp-server/README.md',
        }],
      }],
    }];

    assert.deepStrictEqual(suggestRoutePathHints(tree, 'src'), [
      'coggit/src',
    ]);
    assert.deepStrictEqual(suggestRoutePathHints(tree, 'codebase/src', 'codebase'), [
      'coggit/src',
    ]);
  });

  test('routes sourcePath selection centralizes normalization, miss, and fuzzy hints', () => {
    const tree = [{
      path: 'coggit',
      children: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
      }],
    }];

    assert.deepStrictEqual(selectRoutesBySourcePath(tree, 'codebase/coggit/src', {
      sourceRoot: 'codebase',
    }), {
      normalizedSourcePath: 'coggit/src',
      nodes: [{
        path: 'coggit/src',
        cognition: 'coggit/src/README.md',
      }],
      missed: false,
      pathHints: [],
    });

    assert.deepStrictEqual(selectRoutesBySourcePath(tree, 'codebase/src', {
      sourceRoot: 'codebase',
    }), {
      normalizedSourcePath: 'src',
      nodes: [],
      missed: true,
      pathHints: ['coggit/src'],
    });

    // undefined sourcePath returns full tree without filtering
    assert.deepStrictEqual(selectRoutesBySourcePath(tree, undefined), {
      nodes: tree,
      missed: false,
      pathHints: [],
    });
  });

  test('routes structured content can carry sourcePath hints for a miss', () => {
    const result: RoutesOperationResult = {
      project,
      generatedAt: 1234,
      entryCount: 0,
      entries: [],
      diagnostics: [],
      routes: {
        project,
        generatedAt: 1234,
        entries: [],
        diagnostics: [],
      },
    };

    const structuredContent = routesStructuredContent(result, {
      format: 'tree',
      sourcePath: 'src',
      pathMissMessage: 'No tracked cognition routes matched the requested sourcePath.',
      pathHintMessage: 'You may mean one of these source-root-relative route paths.',
      pathHints: ['.', 'core'],
    });

    assert.deepStrictEqual(
      z.object(routesOperationOutputSchema).parse(structuredContent),
      structuredContent,
    );
    assert.strictEqual(structuredContent.sourcePath, 'src');
    assert.strictEqual(structuredContent.pathMissMessage, 'No tracked cognition routes matched the requested sourcePath.');
    assert.strictEqual(structuredContent.pathHintMessage, 'You may mean one of these source-root-relative route paths.');
    assert.deepStrictEqual(structuredContent.pathHints, ['.', 'core']);
  });

  test('handbook URI is stable', () => {
    assert.strictEqual(handbookUri('skeleton'), 'coggit://handbook/skeleton');
  });
});
