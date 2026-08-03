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

  test('suggests a candidate whose leaf matches after stripping the file extension', () => {
    const hints = suggestPathHints(['coggit/src/registry.ts', 'coggit/src/other.ts'], 'registry');
    assert.deepStrictEqual(hints, ['coggit/src/registry.ts']);
  });

  test('suggests a multi-segment match when only the leaf extension is missing', () => {
    const hints = suggestPathHints(['coggit/src/config/manifest.ts', 'coggit/src/scope.ts'], 'src/config/manifest');
    assert.deepStrictEqual(hints, ['coggit/src/config/manifest.ts']);
  });

  test('suggests a markdown leaf when the query omits the extension', () => {
    const hints = suggestPathHints(['coggit/README.md', 'coggit/package.json'], 'coggit/README');
    assert.deepStrictEqual(hints, ['coggit/README.md']);
  });

  test('exact leaf query matches through trailing segments', () => {
    assert.deepStrictEqual(suggestPathHints(['coggit/src/registry.ts'], 'registry.ts'), ['coggit/src/registry.ts']);
  });

  test('does not strip-match a query against a folder or a mismatched leaf', () => {
    assert.deepStrictEqual(suggestPathHints(['coggit/src/registry.ts', 'coggit/src/capabilities'], 'registry.ts.md'), []);
    assert.deepStrictEqual(suggestPathHints(['coggit/src/registry.ts'], 'registryx'), []);
    assert.deepStrictEqual(suggestPathHints(['coggit/src/registry.ts'], 'registry.md'), []);
  });

  test('does not strip-match an extensioned query against a doubly-suffixed leaf', () => {
    // A query that already names an extension must match a leaf named exactly
    // that, never `registry.ts.md`.
    assert.deepStrictEqual(suggestPathHints(['src/registry.ts.md'], 'registry.ts'), []);
    assert.deepStrictEqual(suggestPathHints(['src/registry.ts.md'], 'src/registry.ts'), []);
  });

  test('does not strip-match a hidden-file query against a suffixed hidden leaf', () => {
    // `.gitignore` and `.gitignore.bak` are different files; a hidden query
    // must not map onto a hidden leaf with an extra suffix.
    assert.deepStrictEqual(suggestPathHints(['src/.gitignore.bak'], '.gitignore'), []);
  });

  test('does not suggest a hidden candidate for a plain leaf query', () => {
    // The candidate-side hidden guard: `.gitignore` is never stripped, so a
    // plain query only matches the real file.
    assert.deepStrictEqual(suggestPathHints(['src/.gitignore', 'src/gitignore.ts'], 'gitignore'), ['src/gitignore.ts']);
  });
});
