import * as assert from 'node:assert';

import { tryGetCognitionPath } from './lookupCognition';
import type { StatusOperationResult } from '../operations';
import type {
  CognitionCoveragePresence,
  NodeStatusInspection,
  ObservedStatus,
} from './statusTypes';

function inspection(overrides: {
  cognitionPath?: string | null;
  cognitionPresence?: CognitionCoveragePresence;
  ownStatus?: ObservedStatus | null;
  status?: ObservedStatus | null;
  descendantStatus?: ObservedStatus | null;
} = {}): NodeStatusInspection {
  const cognitionPath = overrides.cognitionPath !== undefined
    ? overrides.cognitionPath
    : 'src/app/main.ts.md';
  const ownStatus = overrides.ownStatus !== undefined ? overrides.ownStatus : 'fresh';
  const status = overrides.status !== undefined ? overrides.status : ownStatus;
  const descendantStatus = overrides.descendantStatus !== undefined
    ? overrides.descendantStatus
    : null;
  return {
    sourcePath: 'src/app/main.ts',
    cognitionPath,
    cognitionPresence: overrides.cognitionPresence ?? 'present',
    nodeKind: 'file',
    status,
    ownStatus,
    descendantStatus,
    issueSummary: { total: 0, own: 0, descendant: 0 },
    subtreeIssues: { own: [], descendant: [] },
    suggestedActions: [],
    triage: [],
    handbookId: 'leaf',
  };
}

function hit(overrides: {
  cognitionPath?: string | null;
  presence?: CognitionCoveragePresence;
  ownStatus?: ObservedStatus | null;
  status?: ObservedStatus | null;
  descendantStatus?: ObservedStatus | null;
} = {}): StatusOperationResult {
  const cognitionPath = overrides.cognitionPath !== undefined
    ? overrides.cognitionPath
    : 'src/app/main.ts.md';
  const ownStatus = overrides.ownStatus !== undefined ? overrides.ownStatus : 'fresh';
  const status = overrides.status !== undefined ? overrides.status : ownStatus;
  const descendantStatus = overrides.descendantStatus !== undefined
    ? overrides.descendantStatus
    : null;
  return {
    found: true,
    sourcePath: 'src/app/main.ts',
    nodeKind: 'file',
    project: null,
    cognitionPath,
    status,
    ownStatus,
    descendantStatus,
    staleAction: null,
    issueCount: 0,
    ownIssueCount: 0,
    descendantIssueCount: 0,
    issues: [],
    suggestedActions: [],
    handbookId: 'leaf',
    node: null,
    pathHints: [],
    inspection: inspection({
      cognitionPath,
      cognitionPresence: overrides.presence,
      ownStatus,
      status,
      descendantStatus,
    }),
  };
}

function miss(): StatusOperationResult {
  return {
    found: false,
    sourcePath: 'src/never.ts',
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
    pathHints: [],
  };
}

suite('tryGetCognitionPath', () => {
  test('returns null when the source path did not match', () => {
    assert.strictEqual(tryGetCognitionPath(miss()), null);
  });

  test('returns null when cognition is missing', () => {
    assert.strictEqual(tryGetCognitionPath(hit({ presence: 'missing' })), null);
  });

  test('returns null when cognition is not applicable', () => {
    assert.strictEqual(tryGetCognitionPath(hit({ presence: 'not-applicable' })), null);
  });

  test('returns null when found but no inspection is available', () => {
    assert.strictEqual(tryGetCognitionPath({ ...hit(), inspection: undefined }), null);
  });

  test('returns the cognition path with stale false for fresh cognition', () => {
    assert.deepStrictEqual(
      tryGetCognitionPath(hit({ ownStatus: 'fresh' })),
      { cognitionPath: 'src/app/main.ts.md', stale: false },
    );
  });

  test('flags stale cognition', () => {
    assert.deepStrictEqual(
      tryGetCognitionPath(hit({ ownStatus: 'stale' })),
      { cognitionPath: 'src/app/main.ts.md', stale: true },
    );
  });

  test('does not flag conflict as stale', () => {
    assert.deepStrictEqual(
      tryGetCognitionPath(hit({ ownStatus: 'conflict' })),
      { cognitionPath: 'src/app/main.ts.md', stale: false },
    );
  });

  test('does not flag stale when only descendants are stale', () => {
    assert.deepStrictEqual(
      tryGetCognitionPath(hit({ ownStatus: 'fresh', status: 'stale', descendantStatus: 'stale' })),
      { cognitionPath: 'src/app/main.ts.md', stale: false },
    );
  });

  test('does not flag stale when own status is missing', () => {
    assert.deepStrictEqual(
      tryGetCognitionPath(hit({ ownStatus: null })),
      { cognitionPath: 'src/app/main.ts.md', stale: false },
    );
  });

  test('returns null when present but no cognition path is available', () => {
    assert.strictEqual(tryGetCognitionPath(hit({ cognitionPath: null })), null);
  });
});
