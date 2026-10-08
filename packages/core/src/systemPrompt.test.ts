import * as assert from 'node:assert';
import {
  getCoggitSystemPrompt,
  MINIMAL_SYSTEM_PROMPT,
  STANDARD_PROMPT_SEGMENT_KEYS,
  STANDARD_SYSTEM_PROMPT,
  STANDARD_SYSTEM_PROMPT_SEGMENTS,
} from './systemPrompt';

suite('system prompt', () => {
  test('returns the minimal form by default', () => {
    assert.strictEqual(getCoggitSystemPrompt(), MINIMAL_SYSTEM_PROMPT);
    assert.strictEqual(getCoggitSystemPrompt('minimal').kind, 'minimal');
    assert.strictEqual(getCoggitSystemPrompt('standard').kind, 'standard');
  });

  test('minimal form states the mirror relationship and stays surface-neutral', () => {
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /mirrors the source tree/);
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /paired cognition document/);
    assert.match(MINIMAL_SYSTEM_PROMPT.content, /README\.md/);
    assert.match(
      MINIMAL_SYSTEM_PROMPT.content,
      /design intent, contracts, boundaries, and invariants/,
    );
    assert.match(
      MINIMAL_SYSTEM_PROMPT.content,
      /keep the paired cognition document up to date/,
    );
    assert.doesNotMatch(MINIMAL_SYSTEM_PROMPT.content, /coggit_|coggit:\/\//);
  });

  test('standard form content is exactly its segments joined by newlines', () => {
    assert.strictEqual(
      STANDARD_SYSTEM_PROMPT.content,
      STANDARD_SYSTEM_PROMPT_SEGMENTS.map((segment) => segment.text).join('\n'),
    );
    assert.deepStrictEqual(
      STANDARD_SYSTEM_PROMPT_SEGMENTS.map((segment) => segment.key),
      [...STANDARD_PROMPT_SEGMENT_KEYS],
    );
  });

  test('standard form carries the operational guidance as operation references', () => {
    assert.match(STANDARD_SYSTEM_PROMPT.content, /project configured for CogGit/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /the status operation names both roots in its header/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /via per-path status, which names the file's paired cognition document, or the mirror convention/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /`src\/foo\.ts` pairs with `src\/foo\.ts\.md`/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /README\.md at that folder's mirrored path/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /in a project configured for CogGit, keep the paired cognition document up to date/);
    assert.match(STANDARD_SYSTEM_PROMPT.content, /verify edited nodes with the status operation/);
    assert.doesNotMatch(STANDARD_SYSTEM_PROMPT.content, /its README\.md counterpart/);
    assert.doesNotMatch(STANDARD_SYSTEM_PROMPT.content, /coggit_|coggit:\/\//);
    assert.doesNotMatch(STANDARD_SYSTEM_PROMPT.content, /coggit (snapshot|status|handbook)/);
  });

  test('paired-document vocabulary is canonical across forms', () => {
    for (const prompt of [MINIMAL_SYSTEM_PROMPT, STANDARD_SYSTEM_PROMPT]) {
      assert.match(prompt.content, /cognition document/);
      assert.doesNotMatch(prompt.content, /design note/);
      assert.doesNotMatch(prompt.content, /cognition files/);
    }
  });
});
