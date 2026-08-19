import * as assert from 'node:assert';

import { projectStatusAgentPresentation, renderStatusAgentInspectionText } from './statusAgentPresentation';
import type { LocatedStatusIssue, NodeStatusInspection } from './statusTypes';

function locatedIssue(input: {
  sourcePath: string;
  cognitionPath: string | null;
  code: LocatedStatusIssue['issue']['diagnostic']['code'];
  severity: LocatedStatusIssue['issue']['diagnostic']['severity'];
  message: string;
}): LocatedStatusIssue {
  return {
    nodeId: input.sourcePath,
    nodeKind: input.sourcePath.endsWith('.ts') ? 'file' : 'folder',
    sourceUri: { scheme: 'test', authority: '', path: `/workspace/src/${input.sourcePath}`, query: '', fragment: '' },
    cognitionPath: input.cognitionPath,
    relativePath: input.sourcePath,
    hasPairedCognition: input.cognitionPath !== null,
    issue: {
      diagnostic: {
        code: input.code,
        severity: input.severity,
        message: input.message,
      },
      actions: [],
    },
  };
}

suite('agent-facing status presentation', () => {
  test('renders status and action legends once with log-like issue rows', () => {
    const descendantFile = locatedIssue({
      sourcePath: 'src/tools.ts',
      cognitionPath: 'src/tools.ts.md',
      code: 'outdated-cognition',
      severity: 'warning',
      message: 'Stale cognition.',
    });
    const descendantFolder = locatedIssue({
      sourcePath: 'src/feature',
      cognitionPath: 'src/feature/README.md',
      code: 'folder-structure-changed',
      severity: 'warning',
      message: 'Folder structure changed.',
    });
    const inspection: NodeStatusInspection = {
      sourcePath: '.',
      cognitionPath: 'README.md',
      cognitionPresence: 'present',
      nodeKind: 'root',
      status: 'stale',
      ownStatus: 'fresh',
      descendantStatus: 'stale',
      issueSummary: { total: 2, own: 0, descendant: 2 },
      subtreeIssues: { own: [], descendant: [descendantFile, descendantFolder] },
      suggestedActions: [],
      triage: [{
        sourcePath: 'src/tools.ts',
        cognitionPath: 'src/tools.ts.md',
        nodeKind: 'file',
        relation: 'descendant',
        issues: [descendantFile],
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
      }, {
        sourcePath: 'src/feature',
        cognitionPath: 'src/feature/README.md',
        nodeKind: 'folder',
        relation: 'descendant',
        issues: [descendantFolder],
        actions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync folder README with child structure changes',
          handbookId: 'skeleton',
          sourcePath: 'src/feature',
        }, {
          code: 'resolve-stale-cognition',
          label: 'After syncing, accept the pair as reviewed',
          operation: 'resolve',
          sourcePath: 'src/feature',
        }],
      }],
      handbookId: 'skeleton',
    };

    assert.strictEqual(renderStatusAgentInspectionText(inspection), [
      'Status: Stale',
      'Source: .',
      'Cognition: README.md',
      '',
      'Legend:',
      'WARN  stale-cognition  Cognition is out of date with source.',
      'WARN  stale-folder     Folder README is out of date with child structure.',
      '',
      'Actions:',
      'sync-leaf      Read leaf handbook and sync cognition with source.',
      'sync-skeleton  Read skeleton handbook and sync folder README.',
      'resolve        Accept the reviewed pair after sync.',
      '',
      'Own issues: 0',
      '',
      'Descendant issues: 2',
      'WARN | stale-cognition | source=src/tools.ts | actions=sync-leaf,resolve',
      'WARN | stale-folder    | source=src/feature  | actions=sync-skeleton,resolve',
    ].join('\n'));
  });

  test('keeps add as an optional on-demand affordance, not a recommended action', () => {
    const missing = locatedIssue({
      sourcePath: 'src/missing.ts',
      cognitionPath: 'src/missing.ts.md',
      code: 'missing-cognition',
      severity: 'warning',
      message: 'Cognition is missing.',
    });
    const inspection: NodeStatusInspection = {
      sourcePath: 'src/missing.ts',
      cognitionPath: 'src/missing.ts.md',
      cognitionPresence: 'missing',
      nodeKind: 'file',
      status: null,
      ownStatus: null,
      descendantStatus: null,
      issueSummary: { total: 1, own: 1, descendant: 0 },
      subtreeIssues: { own: [missing], descendant: [] },
      suggestedActions: [{
        code: 'create-cognition',
        label: 'Create cognition file',
        operation: 'add',
        sourcePath: 'src/missing.ts',
      }],
      triage: [{
        sourcePath: 'src/missing.ts',
        cognitionPath: 'src/missing.ts.md',
        nodeKind: 'file',
        relation: 'own',
        issues: [missing],
        actions: [],
      }],
      handbookId: 'leaf',
    };

    const view = projectStatusAgentPresentation(inspection);

    assert.deepStrictEqual(view.ownIssues[0].actionTags, []);
    assert.deepStrictEqual(view.ownIssues[0].optionalActionTags, ['add']);
    assert.match(renderStatusAgentInspectionText(inspection), /optional=add/);
    assert.doesNotMatch(renderStatusAgentInspectionText(inspection), /actions=add/);
  });

  test('groups multiple issues for one source into one compact row', () => {
    const stale = locatedIssue({
      sourcePath: 'src/multi.ts',
      cognitionPath: 'src/multi.ts.md',
      code: 'outdated-cognition',
      severity: 'warning',
      message: 'Stale cognition.',
    });
    const brokenLinks = locatedIssue({
      sourcePath: 'src/multi.ts',
      cognitionPath: 'src/multi.ts.md',
      code: 'broken-links',
      severity: 'error',
      message: 'Broken links.',
    });
    const inspection: NodeStatusInspection = {
      sourcePath: '.',
      cognitionPath: 'README.md',
      cognitionPresence: 'present',
      nodeKind: 'root',
      status: 'conflict',
      ownStatus: 'fresh',
      descendantStatus: 'conflict',
      issueSummary: { total: 2, own: 0, descendant: 2 },
      subtreeIssues: { own: [], descendant: [stale, brokenLinks] },
      suggestedActions: [],
      triage: [{
        sourcePath: 'src/multi.ts',
        cognitionPath: 'src/multi.ts.md',
        nodeKind: 'file',
        relation: 'descendant',
        issues: [stale, brokenLinks],
        actions: [{
          code: 'sync-cognition-with-source',
          label: 'Sync cognition with source changes',
          handbookId: 'leaf',
          sourcePath: 'src/multi.ts',
        }, {
          code: 'resolve-stale-cognition',
          label: 'After syncing, accept the pair as reviewed',
          operation: 'resolve',
          sourcePath: 'src/multi.ts',
        }],
      }],
      handbookId: 'skeleton',
    };

    const text = renderStatusAgentInspectionText(inspection);
    const rowMatches = text.match(/^ERROR \| stale-cognition,broken-links \| source=src\/multi\.ts \| actions=sync-leaf,resolve$/gm) ?? [];

    assert.strictEqual(rowMatches.length, 1);
    assert.match(text, /Descendant issues: 2/);
    assert.match(text, /WARN\s+stale-cognition\s+Cognition is out of date with source\./);
    assert.match(text, /ERROR\s+broken-links\s+Cognition contains links that cannot be resolved\./);
    assert.doesNotMatch(text, /^WARN \| stale-cognition \| source=src\/multi\.ts/m);
    assert.doesNotMatch(text, /^ERROR \| broken-links \| source=src\/multi\.ts/m);
  });

  test('renders label-only remediation as an issue-legend hint, not a row action', () => {
    const template = locatedIssue({
      sourcePath: 'src/template.ts',
      cognitionPath: 'src/template.ts.md',
      code: 'template-cognition',
      severity: 'warning',
      message: 'Cognition still has template-like content.',
    });
    template.issue.actions = [{ label: 'Fill in cognition content' }];

    const inspection: NodeStatusInspection = {
      sourcePath: '.',
      cognitionPath: 'README.md',
      cognitionPresence: 'present',
      nodeKind: 'root',
      status: 'stale',
      ownStatus: 'fresh',
      descendantStatus: 'stale',
      issueSummary: { total: 1, own: 0, descendant: 1 },
      subtreeIssues: { own: [], descendant: [template] },
      suggestedActions: [{
        code: 'fill-in-cognition-content',
        label: 'Fill in cognition content',
        sourcePath: 'src/template.ts',
      }],
      triage: [{
        sourcePath: 'src/template.ts',
        cognitionPath: 'src/template.ts.md',
        nodeKind: 'file',
        relation: 'descendant',
        issues: [template],
        actions: [],
      }],
      handbookId: 'skeleton',
    };

    const view = projectStatusAgentPresentation(inspection);
    const text = renderStatusAgentInspectionText(inspection);

    assert.deepStrictEqual(view.issueLegend[0].hints, ['fill-in-cognition-content']);
    assert.match(text, /WARN\s+template-cognition\s+Cognition still has template-like content\.\s+hint=fill-in-cognition-content/);
    assert.match(text, /WARN \| template-cognition \| source=src\/template\.ts/);
    assert.doesNotMatch(text, /actions=fill-in-cognition-content/);
    assert.doesNotMatch(text, /optional=fill-in-cognition-content/);
  });
});
