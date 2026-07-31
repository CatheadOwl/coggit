import * as assert from 'node:assert';

import { InMemoryRegistryProvider } from '../../runtime/vscode/adapter/registryFs';
import { Registry } from './index';
import { applyRegistrySourceRelocations } from './sourceRelocation';
import type { PathKeyRecord } from '../types';

function makeEntry(sourcePath: string | null): PathKeyRecord {
  return {
    sourcePath,
    type: 'leaf',
    sourceFactMtimeMs: null,
    cognitionMtimeMs: null,
    verificationTimeMs: null,
    createdAt: null,
    sourceFactHash: null,
    cognitionBlobHash: null,
    cognitionLength: null,
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

  test('prefix relocation updates the folder record and descendants', async () => {
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
    assert.strictEqual(registry.getEntry('folder')?.sourcePath, 'src/vscode/watch');
    assert.strictEqual(registry.getEntry('child')?.sourcePath, 'src/vscode/watch/watcher.ts');
    assert.strictEqual(registry.getEntry('sibling')?.sourcePath, 'src/watcher/foo.ts');
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
});
