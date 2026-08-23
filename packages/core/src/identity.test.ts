import * as assert from 'node:assert';
import {
  sourcePathToKey,
  cognitionPathToKey,
  keyToCognitionPath,
  isTrackedCognitionFile,
} from './identity';

suite('identity — sourcePathToKey', () => {
  test('strips file extension from regular path', () => {
    assert.strictEqual(sourcePathToKey('src/model/types.ts'), 'src/model/types');
  });

  test('keeps dotfiles dot in the name', () => {
    assert.strictEqual(sourcePathToKey('.eslintrc.js'), '.eslintrc');
    assert.strictEqual(sourcePathToKey('.hidden'), '.hidden');
  });

  test('preserves file without extension', () => {
    assert.strictEqual(sourcePathToKey('noext'), 'noext');
  });

  test('handles double extension like foo.ts.md', () => {
    assert.strictEqual(sourcePathToKey('foo.ts.md'), 'foo.ts');
  });

  test('handles multiple dots in filename', () => {
    assert.strictEqual(sourcePathToKey('my.component.spec.ts'), 'my.component.spec');
  });

  test('normalizes backslashes to forward slashes', () => {
    assert.strictEqual(sourcePathToKey('src\\model\\types.ts'), 'src/model/types');
    assert.strictEqual(sourcePathToKey('src\\utils\\helpers.js'), 'src/utils/helpers');
  });

  test('handles empty string', () => {
    assert.strictEqual(sourcePathToKey(''), '');
  });

  test('handles single segment with extension', () => {
    assert.strictEqual(sourcePathToKey('index.ts'), 'index');
  });

  test('handles path with only dots (not extension)', () => {
    assert.strictEqual(sourcePathToKey('...'), '...');
  });
});

suite('identity — cognitionPathToKey', () => {
  test('converts leaf cognition path to key', () => {
    assert.strictEqual(cognitionPathToKey('src/model/types.ts.md'), 'src/model/types.ts');
  });

  test('converts folder README cognition path to key with trailing slash', () => {
    assert.strictEqual(cognitionPathToKey('src/README.md'), 'src/');
  });

  test('converts root README to root key', () => {
    assert.strictEqual(cognitionPathToKey('README.md'), '/');
  });

  test('handles nested README paths', () => {
    assert.strictEqual(cognitionPathToKey('a/b/c/README.md'), 'a/b/c/');
  });

  test('handles simple leaf path', () => {
    assert.strictEqual(cognitionPathToKey('foo.md'), 'foo');
  });

  test('handles deep nested leaf path', () => {
    assert.strictEqual(cognitionPathToKey('a/b/c/d.md'), 'a/b/c/d');
  });

  test('normalizes backslashes', () => {
    assert.strictEqual(cognitionPathToKey('src\\model\\types.ts.md'), 'src/model/types.ts');
  });

  test('throws on non-.md input', () => {
    assert.throws(
      () => cognitionPathToKey('foo.txt'),
      /cognitionPathToKey: path must end with .md/,
    );
  });

  test('throws on input with no extension', () => {
    assert.throws(
      () => cognitionPathToKey('foo'),
      /cognitionPathToKey: path must end with .md/,
    );
  });
});

suite('identity — keyToCognitionPath', () => {
  test('converts leaf key to .md path', () => {
    assert.strictEqual(keyToCognitionPath('src/model/types', 'leaf'), 'src/model/types.md');
  });

  test('converts folder key to README.md path', () => {
    assert.strictEqual(keyToCognitionPath('src/', 'folder'), 'src/README.md');
    assert.strictEqual(keyToCognitionPath('src/model', 'folder'), 'src/model/README.md');
  });

  test('converts root key to README.md for folder kind', () => {
    assert.strictEqual(keyToCognitionPath('/', 'folder'), 'README.md');
  });

  test('converts root key to .md for leaf kind', () => {
    assert.strictEqual(keyToCognitionPath('/', 'leaf'), '/.md');
  });

  test('ensures folder key ends with slash before appending README', () => {
    assert.strictEqual(keyToCognitionPath('src', 'folder'), 'src/README.md');
  });

  test('leaf kind does not add README suffix', () => {
    assert.strictEqual(keyToCognitionPath('src/index', 'leaf'), 'src/index.md');
  });
});

suite('identity — round-trip consistency', () => {
  test('cognitionPathToKey -> keyToCognitionPath round-trips on leaf', () => {
    const original = 'src/model/types.ts.md';
    const key = cognitionPathToKey(original);
    const back = keyToCognitionPath(key, 'leaf');
    assert.strictEqual(back, 'src/model/types.ts.md');
  });

  test('cognitionPathToKey -> keyToCognitionPath round-trips on folder', () => {
    const original = 'src/model/README.md';
    const key = cognitionPathToKey(original);
    assert.strictEqual(key, 'src/model/');
    const back = keyToCognitionPath(key, 'folder');
    assert.strictEqual(back, 'src/model/README.md');
  });

  test('sourcePathToKey -> keyToCognitionPath round-trips', () => {
    const sourcePath = 'src/model/types.ts';
    const key = sourcePathToKey(sourcePath);
    const cognitionPath = keyToCognitionPath(key, 'leaf');
    assert.strictEqual(cognitionPath, 'src/model/types.md');
  });
});

suite('identity — isTrackedCognitionFile', () => {
  test('README.md at root is tracked', () => {
    assert.strictEqual(isTrackedCognitionFile('README.md'), true);
  });

  test('README.md in subfolder is tracked', () => {
    assert.strictEqual(isTrackedCognitionFile('src/README.md'), true);
    assert.strictEqual(isTrackedCognitionFile('a/b/c/README.md'), true);
  });

  test('source-paired leaf cognition is tracked', () => {
    assert.strictEqual(isTrackedCognitionFile('src/types.ts.md'), true);
    assert.strictEqual(isTrackedCognitionFile('src/model/helpers.js.md'), true);
    assert.strictEqual(isTrackedCognitionFile('foo.spec.ts.md'), true);
  });

  test('dotfile source cognition is tracked', () => {
    assert.strictEqual(isTrackedCognitionFile('.eslintrc.js.md'), true);
  });

  test('free-form cognition without source extension is NOT tracked', () => {
    assert.strictEqual(isTrackedCognitionFile('CODE_MAP.md'), false);
    assert.strictEqual(isTrackedCognitionFile('src/CODE_MAP.md'), false);
    assert.strictEqual(isTrackedCognitionFile('src/core/MODULES.md'), false);
    assert.strictEqual(isTrackedCognitionFile('INDEX.md'), false);
    assert.strictEqual(isTrackedCognitionFile('product-surface-policy.md'), false);
  });

  test('normalizes backslashes', () => {
    assert.strictEqual(isTrackedCognitionFile('src\\types.ts.md'), true);
    assert.strictEqual(isTrackedCognitionFile('src\\CODE_MAP.md'), false);
  });
});
