import * as assert from 'node:assert';

import type { StatusOperationResult } from '../../core/index.js';
import { __testing__ } from './statusTool.js';

const { statusText } = __testing__;

suite('MCP status text surfacing', () => {
  test('renders the compact agent-facing projection', () => {
    const result: StatusOperationResult = {
      found: true,
      sourcePath: 'src/tools.ts',
      nodeKind: 'file',
      project: {
        label: 'fixture',
        configUri: 'file:///workspace/.coggit/config.yaml',
        projectRootUri: 'file:///workspace',
        sourceRootUri: 'file:///workspace/src',
        cognitionRootUri: 'file:///workspace/codebase_cognition',
        sourceRoot: 'src',
        cognitionRoot: 'codebase_cognition',
        sourcePathRule: 'Use source-root-relative paths.',
      },
      cognitionPath: 'src/tools.ts.md',
      status: 'stale',
      ownStatus: 'stale',
      descendantStatus: null,
      staleAction: 'align-cognition-first',
      issueCount: 1,
      ownIssueCount: 1,
      descendantIssueCount: 0,
      issues: [{
        relativePath: 'src/tools.ts',
        severity: 'warning',
        code: 'outdated-cognition',
        message: 'Stale cognition.',
        actions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookId: 'leaf',
          sourcePath: 'src/tools.ts',
        }],
      }],
      suggestedActions: [{
        code: 'sync-cognition-with-source',
        label: 'Sync cognition with source changes',
        handbookId: 'leaf',
        sourcePath: 'src/tools.ts',
      }, {
        code: 'resolve-stale-cognition',
        label: 'After syncing, accept the pair as reviewed',
        operation: 'resolve',
        sourcePath: 'src/tools.ts',
      }],
      handbookId: 'leaf',
      node: null,
      pathHints: [],
      inspection: {
        sourcePath: 'src/tools.ts',
        cognitionPath: 'src/tools.ts.md',
        cognitionPresence: 'present',
        nodeKind: 'file',
        status: 'stale',
        ownStatus: 'stale',
        descendantStatus: null,
        issueSummary: { total: 1, own: 1, descendant: 0 },
        subtreeIssues: {
          own: [{
            nodeId: 'src/tools.ts',
            nodeKind: 'file',
            sourceUri: { scheme: 'file', authority: '', path: '/workspace/src/tools.ts', query: '', fragment: '' },
            cognitionPath: 'src/tools.ts.md',
            relativePath: 'src/tools.ts',
            hasPairedCognition: true,
            issue: {
              diagnostic: {
                code: 'outdated-cognition',
                severity: 'warning',
                message: 'Stale cognition.',
              },
              actions: [{ label: 'Sync cognition with source changes' }],
            },
          }],
          descendant: [],
        },
        suggestedActions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookId: 'leaf',
          sourcePath: 'src/tools.ts',
        }, {
          code: 'resolve-stale-cognition',
          label: 'After syncing, accept the pair as reviewed',
          operation: 'resolve',
          sourcePath: 'src/tools.ts',
        }],
        triage: [{
          sourcePath: 'src/tools.ts',
          cognitionPath: 'src/tools.ts.md',
          nodeKind: 'file',
          relation: 'own',
          issues: [],
          actions: [{
            code: 'sync-cognition-with-source',
            label: 'Sync cognition with source changes',
            handbookId: 'leaf',
            sourcePath: 'src/tools.ts',
          }, {
            code: 'resolve-stale-cognition',
            label: 'After syncing, accept the pair as reviewed',
            operation: 'resolve',
            sourcePath: 'src/tools.ts',
          }],
        }],
        handbookId: 'leaf',
      },
      pathMissMessage: undefined,
      pathHintMessage: undefined,
    };

    assert.match(statusText(result), /Legend:/);
    assert.match(statusText(result), /Actions:/);
    assert.match(statusText(result), /WARN \| stale-cognition \| source=src\/tools\.ts \| actions=sync-leaf,resolve/);
    assert.doesNotMatch(statusText(result), /Suggested next actions:/);
    assert.doesNotMatch(statusText(result), /Subtree triage/);
  });
});
