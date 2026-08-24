import * as assert from 'node:assert';
import {
  getCoggitSystemPrompt,
  MINIMAL_SYSTEM_PROMPT,
} from './systemPrompt';

suite('system prompt', () => {
  test('returns the minimal form by default', () => {
    assert.strictEqual(getCoggitSystemPrompt(), MINIMAL_SYSTEM_PROMPT);
    assert.strictEqual(getCoggitSystemPrompt('minimal').kind, 'minimal');
  });

  test('minimal form states the mirror relationship and stays surface-neutral', () => {
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /mirrors the source tree/);
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /paired design note/);
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /README\.md/);
    assert.match(
      MINIMAL_SYSTEM_PROMPT.content,
      /design intent, contracts, boundaries, and invariants/,
    );
    assert.match(
      MINIMAL_SYSTEM_PROMPT.content,
      /keep the paired cognition up to date/,
    );
    assert.doesNotMatch(MINIMAL_SYSTEM_PROMPT.content, /coggit_|coggit:\/\//);
  });
});
