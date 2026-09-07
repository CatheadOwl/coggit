import * as assert from 'node:assert';

import { InMemoryRegistryProvider } from './inMemoryRegistryProvider';
import { Registry } from './index';
import { applyRegistrySourceRelocations } from './sourceRelocation';
import type { RegistrySourceRelocation } from './sourceRelocation';
import type { PathKeyRecord } from '../types';

function makeEntry(sourcePath: string | null): PathKeyRecord {
  return {
    sourcePath,
    type: 'leaf',
  };
}

async function createRegistry(entries: Record<string, PathKeyRecord>): Promise<Registry> {
  const registry = await Registry.create(new InMemoryRegistryProvider());
  for (const [key, entry] of Object.entries(entries)) {
    registry.setEntry(key, entry);
  }
  return registry;
}

suite('registrySourceRelocation — registry sourcePath rewrite policy', () => {
  test('exact relocation updates only the matching sourcePath record', async () => {
    const registry = await createRegistry({
      exact: makeEntry('src/watch/watcher.ts'),
      child: makeEntry('src/watch/other.ts'),
      nullish: makeEntry(null),
    });

    const changed = applyRegistrySourceRelocations(registry, [{
      kind: 'exact',
      fromSourcePath: 'src/watch/watcher.ts',
      toSourcePath: 'src/vscode/watch/watcher.ts',
    }]);

    assert.strictEqual(changed, true);
    assert.strictEqual(registry.getEntry('exact')?.sourcePath, 'src/vscode/watch/watcher.ts');
    assert.strictEqual(registry.getEntry('child')?.sourcePath, 'src/watch/other.ts');
    assert.strictEqual(registry.getEntry('nullish')?.sourcePath, null);
  });

  test('prefix matches strict descendants only, not the node itself', async () => {
    const registry = await createRegistry({
      folder: makeEntry('src/watch'),
      child: makeEntry('src/watch/watcher.ts'),
      sibling: makeEntry('src/watcher/foo.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [{
      kind: 'prefix',
      fromSourcePath: 'src/watch',
      toSourcePath: 'src/vscode/watch',
    }]);

    assert.strictEqual(changed, true);
    // Behavior change under the closed-set batch relocation design: the folder record no longer moves via
    // the prefix relocation; it needs the paired exact relocation.
    assert.strictEqual(registry.getEntry('folder')?.sourcePath, 'src/watch');
    assert.strictEqual(registry.getEntry('child')?.sourcePath, 'src/vscode/watch/watcher.ts');
    assert.strictEqual(registry.getEntry('sibling')?.sourcePath, 'src/watcher/foo.ts');
  });

  test('closed set (exact + prefix) moves the folder record and descendants', async () => {
    const registry = await createRegistry({
      folder: makeEntry('src/watch'),
      child: makeEntry('src/watch/watcher.ts'),
      sibling: makeEntry('src/watcher/foo.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [
      { kind: 'exact', fromSourcePath: 'src/watch', toSourcePath: 'src/vscode/watch' },
      { kind: 'prefix', fromSourcePath: 'src/watch', toSourcePath: 'src/vscode/watch' },
    ]);

    assert.strictEqual(changed, true);
    assert.strictEqual(registry.getEntry('folder')?.sourcePath, 'src/vscode/watch');
    assert.strictEqual(registry.getEntry('child')?.sourcePath, 'src/vscode/watch/watcher.ts');
    assert.strictEqual(registry.getEntry('sibling')?.sourcePath, 'src/watcher/foo.ts');
  });

  test('longest prefix wins among overlapping prefix relocations', async () => {
    const registry = await createRegistry({
      nested: makeEntry('src/watch/deep/file.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [
      { kind: 'prefix', fromSourcePath: 'src', toSourcePath: 'packages/src' },
      { kind: 'prefix', fromSourcePath: 'src/watch', toSourcePath: 'packages/vscode/watch' },
    ]);

    assert.strictEqual(changed, true);
    assert.strictEqual(registry.getEntry('nested')?.sourcePath, 'packages/vscode/watch/deep/file.ts');
  });

  test('exact beats prefix regardless of order (filename rename in a moved dir)', async () => {
    const entries = () => createRegistry({
      moved: makeEntry('src/mcp-server/main.ts'),
    });

    const direct: RegistrySourceRelocation = {
      kind: 'exact',
      fromSourcePath: 'src/mcp-server/main.ts',
      toSourcePath: 'packages/mcp/src/mcp-stdio.ts',
    };
    const parent: RegistrySourceRelocation = {
      kind: 'prefix',
      fromSourcePath: 'src/mcp-server',
      toSourcePath: 'packages/mcp/src',
    };

    const orderA = await entries();
    applyRegistrySourceRelocations(orderA, [direct, parent]);
    const orderB = await entries();
    applyRegistrySourceRelocations(orderB, [parent, direct]);

    const expected = 'packages/mcp/src/mcp-stdio.ts';
    assert.strictEqual(orderA.getEntry('moved')?.sourcePath, expected);
    assert.strictEqual(orderB.getEntry('moved')?.sourcePath, expected);
  });

  test('relocations never apply transitively through destinations', async () => {
    const registry = await createRegistry({
      moved: makeEntry('src/a.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [
      // Destination of the exact falls under the prefix's fromSourcePath, but
      // matching uses the pre-batch sourcePath only.
      { kind: 'exact', fromSourcePath: 'src/a.ts', toSourcePath: 'dst/x/src/a.ts' },
      { kind: 'prefix', fromSourcePath: 'dst/x/src', toSourcePath: 'elsewhere' },
    ]);

    assert.strictEqual(changed, true);
    assert.strictEqual(registry.getEntry('moved')?.sourcePath, 'dst/x/src/a.ts');
  });

  test('root prefix (fromSourcePath ".") matches nothing', async () => {
    const registry = await createRegistry({
      entry: makeEntry('src/a.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [{
      kind: 'prefix',
      fromSourcePath: '.',
      toSourcePath: 'moved',
    }]);

    assert.strictEqual(changed, false);
    assert.strictEqual(registry.getEntry('entry')?.sourcePath, 'src/a.ts');
  });

  test('returns false when no records match the relocation', async () => {
    const registry = await createRegistry({
      entry: makeEntry('src/other.ts'),
    });

    const changed = applyRegistrySourceRelocations(registry, [{
      kind: 'prefix',
      fromSourcePath: 'src/watch',
      toSourcePath: 'src/vscode/watch',
    }]);

    assert.strictEqual(changed, false);
    assert.strictEqual(registry.getEntry('entry')?.sourcePath, 'src/other.ts');
  });

  test('rejects an equal-specificity batch without mutating the registry', async () => {
    const registry = await createRegistry({
      entry: makeEntry('src/watch/watcher.ts'),
    });

    assert.throws(() => applyRegistrySourceRelocations(registry, [
      { kind: 'prefix', fromSourcePath: 'src/watch', toSourcePath: 'a' },
      { kind: 'prefix', fromSourcePath: 'src/watch', toSourcePath: 'b' },
    ]), /duplicate prefix fromSourcePath/);

    assert.strictEqual(registry.getEntry('entry')?.sourcePath, 'src/watch/watcher.ts');
  });
});
