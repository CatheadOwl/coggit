import * as assert from 'node:assert';
import { InMemoryRegistryProvider } from '@coggit/core/internal';
import { Registry } from '@coggit/core/internal';
import type { RegistryFile } from '@coggit/core';
import { REGISTRY_SCHEMA_VERSION } from '@coggit/core/internal';

function makeFile(entries: Record<string, any> = {}): RegistryFile {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries,
  };
}

suite('InMemoryRegistryProvider — round-trip', () => {
  test('save and load preserves data', async () => {
    const provider = new InMemoryRegistryProvider();
    const file = makeFile({
      'src/foo': {
        sourcePath: 'src/foo.ts',
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    });

    await provider.save(file);
    const loaded = await provider.load();

    assert.ok(loaded !== null);
    assert.strictEqual(loaded.schemaVersion, REGISTRY_SCHEMA_VERSION);
    assert.strictEqual(loaded.entries['src/foo'].sourcePath, 'src/foo.ts');
  });

  test('load returns null when no data saved', async () => {
    const provider = new InMemoryRegistryProvider();
    const loaded = await provider.load();
    assert.strictEqual(loaded, null);
  });

  test('multiple save/load cycles', async () => {
    const provider = new InMemoryRegistryProvider();

    const file1 = makeFile({ 'a': { sourcePath: null } as any });
    await provider.save(file1);

    const loaded1 = await provider.load();
    assert.ok(loaded1 !== null);
    assert.strictEqual(loaded1.entries['a'].sourcePath, null);

    const file2 = makeFile({ 'b': { sourcePath: 'src/b.ts' } as any });
    await provider.save(file2);

    const loaded2 = await provider.load();
    assert.ok(loaded2 !== null);
    // Previous data should be gone, replaced by new data
    assert.strictEqual(loaded2.entries['a'], undefined);
    assert.strictEqual(loaded2.entries['b'].sourcePath, 'src/b.ts');
  });
});

suite('InMemoryRegistryProvider — corrupt', () => {
  test('corrupt() sets schemaVersion to 0', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save(makeFile({ 'a': { sourcePath: null } as any }));

    provider.corrupt();
    const loaded = await provider.load();

    assert.ok(loaded !== null);
    // Schema version should be 0, indicating corruption
    assert.strictEqual(loaded.schemaVersion, 0);
  });

  test('corrupt() causes Registry.create to rebuild cleanly', async () => {
    const provider = new InMemoryRegistryProvider();

    await provider.save(makeFile({
      'a': {
        sourcePath: null,
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: null,
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));

    provider.corrupt();
    const registry = await Registry.create(provider);

    // Corrupt data should have been replaced with empty registry
    assert.strictEqual(registry.getKeys().length, 0);
  });
});

suite('InMemoryRegistryProvider — deep clone isolation', () => {
  test('mutating loaded data does not affect provider state', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save(makeFile({
      'src/foo': {
        sourcePath: 'src/foo.ts',
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));

    const loaded = await provider.load();
    assert.ok(loaded !== null);
    // Mutate the loaded data
    loaded.entries['src/foo'].sourcePath = 'src/foo.test.ts';
    loaded.entries['src/new'] = { sourcePath: 'src/new.ts' } as any;

    // Re-load from provider — should be unchanged
    const reloaded = await provider.load();
    assert.ok(reloaded !== null);
    assert.deepStrictEqual(
      reloaded.entries['src/foo'].sourcePath,
      'src/foo.ts', // Original value, not mutated
    );
    assert.strictEqual(reloaded.entries['src/new'], undefined);
  });

  test('nested object mutations on loaded data are isolated', async () => {
    const provider = new InMemoryRegistryProvider();
    const originalEntry = {
      sourcePath: 'src/foo.ts',
      type: 'leaf' as const,
      sourceFactMtimeMs: null,
      cognitionMtimeMs: null,
      verificationTimeMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceFactHash: null,
      cognitionBlobHash: null,
      cognitionLength: null,
    };

    await provider.save(makeFile({ 'src/foo': originalEntry }));

    const loaded1 = await provider.load();
    assert.ok(loaded1 !== null);
    loaded1.entries['src/foo'].verificationTimeMs = 1234;

    const loaded2 = await provider.load();
    assert.ok(loaded2 !== null);
    assert.strictEqual(loaded2.entries['src/foo'].verificationTimeMs, null);
  });

  test('mutating saved input does not affect stored state', async () => {
    const provider = new InMemoryRegistryProvider();
    const entry = {
      sourcePath: 'src/dynamic.ts',
      type: 'leaf' as const,
      sourceFactMtimeMs: null,
      cognitionMtimeMs: null,
      verificationTimeMs: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      sourceFactHash: null,
      cognitionBlobHash: null,
      cognitionLength: null,
    };

    const file = makeFile({ 'src/dynamic': entry });
    await provider.save(file);

    // Mutate the object we saved
    entry.sourcePath = 'src/extra.ts';

    // Reload — should still have original data
    const loaded = await provider.load();
    assert.ok(loaded !== null);
    assert.deepStrictEqual(
      loaded.entries['src/dynamic'].sourcePath,
      'src/dynamic.ts',
    );
  });
});
