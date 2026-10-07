import * as assert from 'node:assert';
import { getCoggitSystemPrompt } from '@coggit/core';

import { runInstructions } from './instructions';

suite('CLI instructions', () => {
  test('raw format prints the form content unchanged', () => {
    for (const kind of ['minimal', 'standard'] as const) {
      assert.strictEqual(runInstructions(kind, 'raw'), getCoggitSystemPrompt(kind).content);
    }
  });

  test('block format wraps the content in managed markers carrying kind and version', () => {
    for (const kind of ['minimal', 'standard'] as const) {
      const prompt = getCoggitSystemPrompt(kind);
      const lines = runInstructions(kind, 'block').split('\n');
      assert.strictEqual(lines[0], `<!-- coggit:begin system-prompt kind=${prompt.kind} version=${prompt.version} -->`);
      assert.strictEqual(lines[lines.length - 1], '<!-- coggit:end -->');
      assert.strictEqual(lines.slice(1, -1).join('\n'), prompt.content);
    }
  });
});
