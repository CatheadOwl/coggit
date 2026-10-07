import * as assert from 'node:assert';
import { getCoggitSystemPrompt } from '@coggit/core';

import { CLI_ENTRY_SENTENCE, runInstructions } from './instructions';

function expectedComposite(kind: 'minimal' | 'standard'): string {
  return [CLI_ENTRY_SENTENCE, getCoggitSystemPrompt(kind).content].join('\n');
}

suite('CLI instructions', () => {
  test('raw format prepends the entry sentence to the form content', () => {
    for (const kind of ['minimal', 'standard'] as const) {
      assert.strictEqual(runInstructions(kind, 'raw'), expectedComposite(kind));
    }
  });

  test('block format wraps the entry + content composite in managed markers', () => {
    for (const kind of ['minimal', 'standard'] as const) {
      const prompt = getCoggitSystemPrompt(kind);
      const lines = runInstructions(kind, 'block').split('\n');
      assert.strictEqual(lines[0], `<!-- coggit:begin system-prompt kind=${prompt.kind} version=${prompt.version} -->`);
      assert.strictEqual(lines[lines.length - 1], '<!-- coggit:end -->');
      assert.strictEqual(lines.slice(1, -1).join('\n'), expectedComposite(kind));
    }
  });

  test('the entry sentence names the CLI entry and nothing more', () => {
    assert.match(CLI_ENTRY_SENTENCE, /`coggit` CLI/);
    assert.match(CLI_ENTRY_SENTENCE, /--help/);
    // The access layer teaches no command mechanics (restraint rule:
    // entry + stance only; --help self-describes).
    assert.doesNotMatch(CLI_ENTRY_SENTENCE, /snapshot|status|handbook|init/);
  });
});
