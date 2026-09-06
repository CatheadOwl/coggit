import * as assert from 'node:assert';
import type { UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot } from './types';
import { projectContextFromRoot } from './project/projectContext';
import {
  sourceIdentityToCognitionIdentity,
  cognitionIdentityToSourceIdentity,
  sourceIdentityToProjectRelative,
  cognitionIdentityToProjectRelative,
  projectRelativeToSourceIdentity,
  projectRelativePair,
} from './mapping';

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

function makeRoot(): CoggitWorkspaceRoot {
  return {
    id: 'root',
    label: 'root',
    workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
    configUri: uri('/workspace/.coggit/config.yaml'),
    projectRootUri: uri('/workspace'),
    sourceRootUri: uri('/workspace/codebase'),
    cognitionRootUri: uri('/workspace/codebase_cognition'),
  };
}

suite('path-coordinate contract', () => {
  test('identity → project-relative prepends the configured root name', () => {
    const root = makeRoot();
    assert.strictEqual(sourceIdentityToProjectRelative(root, 'src/main.ts'), 'codebase/src/main.ts');
    assert.strictEqual(
      cognitionIdentityToProjectRelative(root, 'src/main.ts.md'),
      'codebase_cognition/src/main.ts.md',
    );
  });

  test('source root identity "." maps to the root name, never "name/."', () => {
    const root = makeRoot();
    assert.strictEqual(sourceIdentityToProjectRelative(root, '.'), 'codebase');
    assert.strictEqual(cognitionIdentityToProjectRelative(root, 'README.md'), 'codebase_cognition/README.md');
  });

  test('project-relative → identity strips the prefix', () => {
    const root = makeRoot();
    assert.strictEqual(projectRelativeToSourceIdentity(root, 'codebase/src/main.ts'), 'src/main.ts');
    assert.strictEqual(projectRelativeToSourceIdentity(root, 'codebase'), '.');
    // Non-prefixed paths pass through as the legacy source-root-relative fallback.
    assert.strictEqual(projectRelativeToSourceIdentity(root, 'src/main.ts'), 'src/main.ts');
  });

  test('a "."-configured root adds no prefix', () => {
    const root = makeRoot();
    root.sourceRootUri = root.projectRootUri;
    assert.strictEqual(sourceIdentityToProjectRelative(root, 'src/main.ts'), 'src/main.ts');
    assert.strictEqual(sourceIdentityToProjectRelative(root, '.'), '.');
  });

  test('source↔cognition geometry is the single convention (leaf / folder / root / free-form)', () => {
    assert.strictEqual(sourceIdentityToCognitionIdentity('src/a.ts', 'leaf'), 'src/a.ts.md');
    assert.strictEqual(sourceIdentityToCognitionIdentity('src/app', 'folder'), 'src/app/README.md');
    assert.strictEqual(sourceIdentityToCognitionIdentity('.', 'folder'), 'README.md');

    assert.deepStrictEqual(cognitionIdentityToSourceIdentity('src/a.ts.md'), { sourceIdentity: 'src/a.ts', kind: 'leaf' });
    assert.deepStrictEqual(cognitionIdentityToSourceIdentity('src/app/README.md'), { sourceIdentity: 'src/app', kind: 'folder' });
    assert.deepStrictEqual(cognitionIdentityToSourceIdentity('README.md'), { sourceIdentity: '.', kind: 'folder' });
    assert.strictEqual(cognitionIdentityToSourceIdentity('CODE_MAP.md'), undefined);
    assert.strictEqual(cognitionIdentityToSourceIdentity('.hidden.md'), undefined);
  });

  test('project context exposes projectRootUri + root names, not internal root URIs', () => {
    const context = projectContextFromRoot(makeRoot());
    assert.strictEqual(context.projectRootUri, 'test:///workspace');
    assert.strictEqual(context.sourceRoot, 'codebase');
    assert.strictEqual(context.cognitionRoot, 'codebase_cognition');
    assert.strictEqual(typeof context.sourcePathRule, 'string');
    assert.ok(!('sourceRootUri' in context));
    assert.ok(!('cognitionRootUri' in context));
  });

  suite('projectRelativePair classification (separated layout)', () => {
    test('source-side paths return the canonicalized input', () => {
      const root = makeRoot();
      assert.deepStrictEqual(projectRelativePair(root, 'codebase/src/a.ts'), {
        side: 'source',
        sourcePath: 'codebase/src/a.ts',
      });
      // Outside any root prefix: legacy fallback, still source side.
      assert.deepStrictEqual(projectRelativePair(root, 'src/a.ts'), {
        side: 'source',
        sourcePath: 'src/a.ts',
      });
    });

    test('cognition-side leaf and folder readings map to their paired source', () => {
      const root = makeRoot();
      assert.deepStrictEqual(projectRelativePair(root, 'codebase_cognition/a/b.ts.md'), {
        side: 'cognition',
        sourcePath: 'codebase/a/b.ts',
      });
      assert.deepStrictEqual(projectRelativePair(root, 'codebase_cognition/x/README.md'), {
        side: 'cognition',
        sourcePath: 'codebase/x',
      });
    });

    test('free-form cognition docs and the cognition root itself are undefined', () => {
      const root = makeRoot();
      assert.strictEqual(projectRelativePair(root, 'codebase_cognition/CODE_MAP.md'), undefined);
      assert.strictEqual(projectRelativePair(root, 'codebase_cognition'), undefined);
    });

    test('backslash input is normalized', () => {
      const root = makeRoot();
      assert.deepStrictEqual(projectRelativePair(root, 'codebase_cognition\\a\\b.ts.md'), {
        side: 'cognition',
        sourcePath: 'codebase/a/b.ts',
      });
      assert.deepStrictEqual(projectRelativePair(root, 'codebase\\src\\a.ts'), {
        side: 'source',
        sourcePath: 'codebase/src/a.ts',
      });
    });
  });

  suite('projectRelativePair classification (sibling layout)', () => {
    function makeSiblingRoot(): CoggitWorkspaceRoot {
      const root = makeRoot();
      root.sourceRootUri = root.projectRootUri;
      root.cognitionRootUri = root.projectRootUri;
      return root;
    }

    test('paired readings map to their paired source', () => {
      const root = makeSiblingRoot();
      assert.deepStrictEqual(projectRelativePair(root, 'src/a.ts.md'), {
        side: 'cognition',
        sourcePath: 'src/a.ts',
      });
      // README heuristic: a shared-tree README.md is classified as the
      // folder cognition pairing, not as a source file.
      assert.deepStrictEqual(projectRelativePair(root, 'src/README.md'), {
        side: 'cognition',
        sourcePath: 'src',
      });
    });

    test('non-paired paths fall through to the source side', () => {
      const root = makeSiblingRoot();
      assert.deepStrictEqual(projectRelativePair(root, 'src/a.ts'), {
        side: 'source',
        sourcePath: 'src/a.ts',
      });
      // Plain markdown with no source-like extension has no pairing.
      assert.deepStrictEqual(projectRelativePair(root, 'src/notes.md'), {
        side: 'source',
        sourcePath: 'src/notes.md',
      });
    });
  });
});
