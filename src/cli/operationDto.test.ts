import * as assert from 'node:assert';

import type { AddOperationResult, ResolveOperationResult, StatusOperationResult } from '../core';
import { renderAddOperationResult, renderResolveOperationResult, renderStatusOperationResult } from './operationDto';

suite('CLI operation DTO surfacing', () => {
  test('add success reports the created cognition without a verify re-check', () => {
    const result: AddOperationResult = {
      success: true,
      created: true,
      kind: 'leaf',
      sourcePath: 'src/main.ts',
      cognitionPath: 'src/main.ts.md',
      project: null,
      handbookId: 'leaf',
      suggestedActions: [],
      error: null,
      pathHints: [],
    };
    const text = renderAddOperationResult(result);
    assert.match(text, /Created leaf cognition: src\/main\.ts\.md/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('add miss renders path hints, not a verify re-check', () => {
    const result: AddOperationResult = {
      success: false,
      created: null,
      kind: null,
      sourcePath: 'src/missing.ts',
      cognitionPath: null,
      project: null,
      handbookId: null,
      suggestedActions: [],
      error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
      pathHints: [],
      pathMissMessage: 'Path not found in any CogGit project: src/missing.ts',
    };
    const text = renderAddOperationResult(result);
    assert.match(text, /Path not found in any CogGit project: src\/missing\.ts/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('add non-miss failure surfaces a verify re-check', () => {
    const result: AddOperationResult = {
      success: false,
      created: null,
      kind: null,
      sourcePath: 'src/folder',
      cognitionPath: null,
      project: null,
      handbookId: null,
      suggestedActions: [{
        code: 'recheck-status',
        label: 'Re-check the current status of this source path.',
        operation: 'status',
        sourcePath: 'src/folder',
      }],
      error: { code: 'invalid-kind', message: 'Cannot create leaf cognition for a folder.' },
      pathHints: [],
    };
    const text = renderAddOperationResult(result);
    assert.match(text, /Cannot create leaf cognition for a folder\./);
    assert.match(text, /Next: verify current status with coggit status src\/folder/);
  });

  test('resolve success is self-confirming, no verify re-check', () => {
    const result: ResolveOperationResult = {
      success: true,
      sourcePath: 'src/main.ts',
      cognitionPath: 'src/main.ts.md',
      project: null,
      sourceKey: 'src/main.ts',
      verificationTimeMs: 1710000000000,
      suggestedActions: [],
      error: null,
      pathHints: [],
    };
    const text = renderResolveOperationResult(result);
    assert.match(text, /Resolved: yes/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('resolve miss renders path hints, not a verify re-check', () => {
    const result: ResolveOperationResult = {
      success: false,
      sourcePath: 'src/missing.ts',
      cognitionPath: null,
      project: null,
      sourceKey: null,
      verificationTimeMs: null,
      suggestedActions: [],
      error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
      pathHints: [],
      pathMissMessage: 'Path not found in any CogGit project: src/missing.ts',
    };
    const text = renderResolveOperationResult(result);
    assert.match(text, /Path not found in any CogGit project: src\/missing\.ts/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('resolve non-miss failure surfaces a verify re-check', () => {
    const result: ResolveOperationResult = {
      success: false,
      sourcePath: 'src/main.ts',
      cognitionPath: null,
      project: null,
      sourceKey: null,
      verificationTimeMs: null,
      suggestedActions: [{
        code: 'recheck-status',
        label: 'Re-check the current status of this source path.',
        operation: 'status',
        sourcePath: 'src/main.ts',
      }],
      error: { code: 'content-changed', message: 'Content changed during resolve.' },
      pathHints: [],
    };
    const text = renderResolveOperationResult(result);
    assert.match(text, /Resolve failed for src\/main\.ts/);
    assert.match(text, /Next: verify current status with coggit status src\/main\.ts/);
  });

  test('status hit renders operation-bearing next steps as CLI commands', () => {
    const missingIssue = {
      nodeId: 'src/missing.ts',
      nodeKind: 'file' as const,
      sourceUri: { scheme: 'test', authority: '', path: '/workspace/src/src/missing.ts', query: '', fragment: '' },
      cognitionPath: null,
      relativePath: 'src/missing.ts',
      hasPairedCognition: false,
      issue: {
        diagnostic: {
          code: 'missing-cognition' as const,
          severity: 'warning' as const,
          message: 'Cognition is missing.',
        },
        actions: [{ label: 'Create cognition file' }],
      },
    };
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/missing.ts',
      nodeKind: 'file',
      project: null,
      cognitionPath: null,
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      staleAction: null,
      issueCount: 1,
      ownIssueCount: 1,
      descendantIssueCount: 0,
      issues: [{
        relativePath: 'src/missing.ts',
        severity: 'warning',
        code: 'missing-cognition',
        message: 'Cognition is missing.',
        actions: [{
          code: 'create-cognition',
          label: 'Create cognition file',
          operation: 'add',
          sourcePath: 'src/missing.ts',
        }],
      }],
      suggestedActions: [{
        code: 'create-cognition',
        label: 'Create cognition file',
        operation: 'add',
        sourcePath: 'src/missing.ts',
      }],
      handbookId: 'leaf',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/missing.ts',
        cognitionPath: null,
        cognitionPresence: 'missing',
        nodeKind: 'file',
        status: 'stale',
        ownStatus: 'stale',
        descendantStatus: null,
        issueSummary: { total: 1, own: 1, descendant: 0 },
        subtreeIssues: { own: [missingIssue], descendant: [] },
        suggestedActions: [{
          code: 'create-cognition',
          label: 'Create cognition file',
          operation: 'add',
          sourcePath: 'src/missing.ts',
        }],
        triage: [],
        handbookId: 'leaf',
      },
    };
    const text = renderStatusOperationResult(result);
    assert.match(text, /Legend:/);
    assert.match(text, /Actions:/);
    assert.match(text, /WARN \| missing-cognition \| source=src\/missing\.ts \| optional=add/);
    assert.doesNotMatch(text, /Suggested actions:/);
    assert.doesNotMatch(text, /Subtree triage:/);
  });

  test('status stale hit renders compact sync and resolve rows', () => {
    const staleIssue = {
      nodeId: 'src/stale.ts',
      nodeKind: 'file' as const,
      sourceUri: { scheme: 'test', authority: '', path: '/workspace/src/src/stale.ts', query: '', fragment: '' },
      cognitionPath: 'src/stale.ts.md',
      relativePath: 'src/stale.ts',
      hasPairedCognition: true,
      issue: {
        diagnostic: {
          code: 'outdated-cognition' as const,
          severity: 'warning' as const,
          message: 'Stale cognition.',
        },
        actions: [{ label: 'Sync cognition with source changes' }],
      },
    };
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
      issues: [{
        relativePath: 'src/stale.ts',
        severity: 'warning',
        code: 'outdated-cognition',
        message: 'Stale cognition.',
        actions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookId: 'leaf',
          sourcePath: 'src/stale.ts',
        }],
      }],
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
        subtreeIssues: { own: [staleIssue], descendant: [] },
        suggestedActions: staleActions,
        triage: [{
          sourcePath: 'src/stale.ts',
          cognitionPath: 'src/stale.ts.md',
          nodeKind: 'file',
          relation: 'own',
          issues: [staleIssue],
          actions: staleActions,
        }],
        handbookId: 'leaf',
      },
    };
    const text = renderStatusOperationResult(result);
    assert.match(text, /Legend:/);
    assert.match(text, /Actions:/);
    assert.match(text, /WARN \| stale-cognition \| source=src\/stale\.ts \| actions=sync-leaf,resolve/);
    assert.doesNotMatch(text, /Suggested actions:/);
    assert.doesNotMatch(text, /Subtree triage:/);
  });

  test('status folder hit renders per-descendant compact triage rows', () => {
    const descendantIssue = {
      nodeId: 'src/app/main.ts',
      nodeKind: 'file' as const,
      sourceUri: { scheme: 'test', authority: '', path: '/workspace/src/src/app/main.ts', query: '', fragment: '' },
      cognitionPath: 'src/app/main.ts.md',
      relativePath: 'src/app/main.ts',
      hasPairedCognition: true,
      issue: {
        diagnostic: {
          code: 'outdated-cognition' as const,
          severity: 'warning' as const,
          message: 'Stale cognition.',
        },
        actions: [{ label: 'Sync cognition with source changes' }],
      },
    };
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
      issues: [{
        relativePath: 'src/app/main.ts',
        severity: 'warning',
        code: 'outdated-cognition',
        message: 'Stale cognition.',
        actions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookId: 'leaf',
          sourcePath: 'src/app/main.ts',
        }],
      }],
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
        subtreeIssues: { own: [], descendant: [descendantIssue] },
        suggestedActions: [],
        triage: [{
          sourcePath: 'src/app/main.ts',
          cognitionPath: 'src/app/main.ts.md',
          nodeKind: 'file',
          relation: 'descendant',
          issues: [descendantIssue],
          actions: descendantActions,
        }],
        handbookId: 'skeleton',
      },
    };
    const text = renderStatusOperationResult(result);
    assert.match(text, /Descendant issues: 1/);
    assert.match(text, /WARN \| stale-cognition \| source=src\/app\/main\.ts \| actions=sync-leaf,resolve/);
    assert.doesNotMatch(text, /Suggested actions:/);
    assert.doesNotMatch(text, /Subtree triage:/);
  });

  test('status hit without operation actions omits the actions legend', () => {
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
      handbookId: 'leaf',
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
        handbookId: 'leaf',
      },
    };
    const text = renderStatusOperationResult(result);
    assert.doesNotMatch(text, /Actions:/);
    assert.doesNotMatch(text, /Legend:/);
  });
});
