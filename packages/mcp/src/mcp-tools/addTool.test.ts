import * as assert from 'node:assert';

import type { AddOperationResult } from '@coggit/core';
import { __testing__ } from './addTool.js';

const { addText } = __testing__;

function successResult(): AddOperationResult {
  return {
    success: true,
    created: true,
    kind: 'leaf',
    sourcePath: 'src/main.ts',
    sourceUri: null,
    cognitionPath: 'src/main.ts.md',
    cognitionUri: null,
    project: null,
    handbookId: 'leaf',
    suggestedActions: [],
    error: null,
    pathHints: [],
  };
}

function missResult(): AddOperationResult {
  return {
    success: false,
    created: null,
    kind: null,
    sourcePath: 'src/missing.ts',
    sourceUri: null,
    cognitionPath: null,
    cognitionUri: null,
    project: null,
    handbookId: null,
    suggestedActions: [],
    error: { code: 'path-not-found', message: 'Path not found in any CogGit project.' },
    pathHints: [],
    pathMissMessage: 'Path not found in any CogGit project: src/missing.ts',
  };
}

function failureResult(): AddOperationResult {
  return {
    success: false,
    created: null,
    kind: null,
    sourcePath: 'src/folder',
    sourceUri: null,
    cognitionPath: null,
    cognitionUri: null,
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
}

suite('MCP add text surfacing', () => {
  test('success points at the handbook, not a verify re-check', () => {
    const text = addText(successResult());
    assert.match(text, /Next: read coggit:\/\/handbook\/leaf/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('a miss renders path hints, not a verify re-check', () => {
    const text = addText(missResult());
    assert.match(text, /Path not found in any CogGit project: src\/missing\.ts/);
    assert.doesNotMatch(text, /Next: verify/);
  });

  test('a non-miss failure surfaces a verify re-check', () => {
    const text = addText(failureResult());
    assert.match(text, /Add failed for src\/folder/);
    assert.match(text, /Next: verify with coggit_status for src\/folder/);
  });
});
