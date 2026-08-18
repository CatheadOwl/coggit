import * as assert from 'node:assert';

import type { AddOperationResult, ResolveOperationResult } from '../core';
import { renderAddOperationResult, renderResolveOperationResult } from './operationDto';

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
});
