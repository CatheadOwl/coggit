import * as assert from 'node:assert';

import type { ResolveOperationResult } from '../../core/index.js';
import { __testing__ } from './resolveTool.js';

const { resolveText } = __testing__;

function successResult(): ResolveOperationResult {
  return {
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
}

function missResult(): ResolveOperationResult {
  return {
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
}

function failureResult(): ResolveOperationResult {
  return {
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
}

suite('MCP resolve text surfacing', () => {
  test('success is self-confirming, no verify re-check', () => {
    const text = resolveText(successResult());
    assert.match(text, /Resolved/);
    assert.match(text, /Source key: src\/main\.ts/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('a miss renders path hints, not a verify re-check', () => {
    const text = resolveText(missResult());
    assert.match(text, /Path not found in any CogGit project: src\/missing\.ts/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('a non-miss failure surfaces a verify re-check', () => {
    const text = resolveText(failureResult());
    assert.match(text, /Resolve failed for src\/main\.ts/);
    assert.match(text, /Next: verify with coggit_status for src\/main\.ts/);
  });
});
