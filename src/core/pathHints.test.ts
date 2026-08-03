import * as assert from 'node:assert';

import { suggestPathHints } from './pathHints';

suite('core pathHints — fuzzy source-path hints', () => {
  test('suggests a source-root-relative path whose trailing segments match', () => {
    const candidates = [
      'coggit/src/core/watchPipeline.ts',
      'coggit/src/core/watchHost.ts',
      'other/main.ts',
    ];

    const hints = suggestPathHints(candidates, 'src/core/watchPipeline.ts');

    assert.deepStrictEqual(hints, ['coggit/src/core/watchPipeline.ts']);
  });

  test('suggests trailing-segment matches in input order and caps at five', () => {
    const candidates = [
      'a/b/c.ts',
      'x/a/b/c.ts',
      'y/a/b/c.ts',
      'z/a/b/c.ts',
      'w/a/b/c.ts',
      'v/a/b/c.ts',
    ];

    const hints = suggestPathHints(candidates, 'a/b/c.ts');

    assert.deepStrictEqual(hints, ['x/a/b/c.ts', 'y/a/b/c.ts', 'z/a/b/c.ts', 'w/a/b/c.ts', 'v/a/b/c.ts']);
    assert.ok(hints.includes('a/b/c.ts') === false);
  });

  test('does not return the exact match itself', () => {
    const hints = suggestPathHints(['coggit/src/core/watchPipeline.ts'], 'coggit/src/core/watchPipeline.ts');
    assert.deepStrictEqual(hints, []);
  });

  test('returns empty when nothing matches', () => {
    const hints = suggestPathHints(['coggit/src/main.ts'], 'coggit/src/core/watchPipeline.ts');
    assert.deepStrictEqual(hints, []);
  });

  test('skips empty or root source paths', () => {
    assert.deepStrictEqual(suggestPathHints(['a.ts', 'b.ts'], ''), []);
    assert.deepStrictEqual(suggestPathHints(['a.ts', 'b.ts'], '.'), []);
  });

  test('deduplicates repeated candidate hits', () => {
    const hints = suggestPathHints(['a/x/y.ts', 'a/x/y.ts', 'b/x/y.ts'], 'x/y.ts');
    assert.deepStrictEqual(hints, ['a/x/y.ts', 'b/x/y.ts']);
  });
});
