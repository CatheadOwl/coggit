import * as assert from 'node:assert';

import {
  projectStatusPresentation,
  renderStatusPresentation,
} from './statusPresentation';
import type { NodeStatusInspection } from './statusTypes';

function inspection(): NodeStatusInspection {
  return {
    sourcePath: 'src/app',
    cognitionPath: 'src/app/README.md',
    cognitionPresence: 'missing',
    nodeKind: 'folder',
    status: 'stale',
    ownStatus: null,
    descendantStatus: 'stale',
    issueSummary: { total: 1, own: 0, descendant: 1 },
    subtreeIssues: {
      own: [],
      descendant: [{
        nodeId: 'src/app/main.ts',
        nodeKind: 'file',
        sourceUri: { scheme: 'file', authority: '', path: '/workspace/src/app/main.ts', query: '', fragment: '' },
        cognitionUri: { scheme: 'file', authority: '', path: '/workspace/cognition/app/main.ts.md', query: '', fragment: '' },
        cognitionPath: 'src/app/main.ts.md',
        relativePath: 'src/app/main.ts',
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
    },
    suggestedActions: [],
    handbookId: 'skeleton',
    verify: { operation: 'status', sourcePath: 'src/app' },
  };
}

suite('status presentation SDK', () => {
  test('projects serializable status data for downstream consumers', () => {
    const view = projectStatusPresentation(inspection());

    assert.deepStrictEqual(view, {
      sourcePath: 'src/app',
      cognitionPath: 'src/app/README.md',
      cognitionPresence: 'missing',
      scope: 'subtree',
      status: 'stale',
      ownStatus: null,
      descendantStatus: 'stale',
      ownIssues: [],
      descendantIssues: [{
        sourcePath: 'src/app/main.ts',
        cognitionPath: 'src/app/main.ts.md',
        severity: 'warning',
        message: 'Stale cognition.',
        suggestedActions: ['Sync cognition with source changes'],
      }],
    });
  });

  test('renders standard text and markdown from the same view', () => {
    const view = projectStatusPresentation(inspection());

    assert.strictEqual(renderStatusPresentation(view, 'text'), [
      'Status: Stale',
      'Source: src/app',
      'Cognition: Not created (add on demand)',
      '',
      'Own issues: 0',
      '',
      'Descendant issues: 1',
      '- src/app/main.ts: [warning] Stale cognition. Suggested actions: Sync cognition with source changes.',
    ].join('\n'));
    assert.strictEqual(renderStatusPresentation(view, 'markdown'), [
      '**Status**: Stale',
      '**Source**: src/app',
      '**Cognition**: Not created (add on demand)',
      '',
      '**Own issues**: 0',
      '',
      '**Descendant issues**: 1',
      '- src/app/main.ts: [warning] Stale cognition. Suggested actions: Sync cognition with source changes.',
    ].join('  \n'));
  });

  test('own scope excludes descendant presentation without changing structured source data', () => {
    const view = projectStatusPresentation(inspection(), 'own');

    assert.strictEqual(view.scope, 'own');
    assert.strictEqual(view.status, null);
    assert.deepStrictEqual(view.descendantIssues, []);
    assert.doesNotMatch(renderStatusPresentation(view), /Descendant issues/);
  });
});
