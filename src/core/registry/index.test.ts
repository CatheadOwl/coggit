import * as assert from 'node:assert';
import {
  REGISTRY_MAINTENANCE_NOTICE,
  REGISTRY_SCHEMA_VERSION,
  Registry,
  RegistryRevisionMismatchError,
} from './index';
import { InMemoryRegistryProvider } from '../../runtime/vscode/adapter/registryFs';
import type { PathKeyRecord } from '../types';
import type { CoggitLogEvent } from '../logger';

function makeEntry(overrides: Partial<PathKeyRecord> = {}): PathKeyRecord {
  return {
    sourcePath: 'src/test.ts',
    type: 'leaf',
    createdAt: new Date().toISOString(),
    accepted: null,
    cognitionBlobHash: null,
    cognitionLength: null,
    ...overrides,
  };
}

function makeFolderEntry(overrides: Partial<PathKeyRecord> = {}): PathKeyRecord {
  return {
    sourcePath: 'src',
    type: 'folder',
    createdAt: new Date().toISOString(),
    accepted: null,
    cognitionBlobHash: null,
    cognitionLength: null,
    ...overrides,
  };
}

suite('Registry — create', () => {
  test('creates empty registry when provider has no data', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    assert.strictEqual(registry.getKeys().length, 0);
  });

  test('loads existing entries from provider', async () => {
    const provider = new InMemoryRegistryProvider();
    const entry = makeEntry({ sourcePath: 'src/foo.ts' });

    // Seed data through the provider
    await provider.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: { 'src/foo': entry },
    });

    const registry = await Registry.create(provider);
    assert.strictEqual(registry.hasEntry('src/foo'), true);
    assert.deepStrictEqual(registry.getEntry('src/foo'), entry);
  });

  test('schema version mismatch triggers clean rebuild', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save({
      schemaVersion: 0, // Mismatch — expected 1
      updatedAt: new Date().toISOString(),
      entries: { 'src/foo': makeEntry() },
    });

    const registry = await Registry.create(provider);
    // Old data should be gone
    assert.strictEqual(registry.hasEntry('src/foo'), false);
    assert.strictEqual(registry.getKeys().length, 0);
  });

  test('future schema version also triggers clean rebuild', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION + 1,
      updatedAt: new Date().toISOString(),
      entries: { 'src/foo': makeEntry() },
    });

    const registry = await Registry.create(provider);
    assert.strictEqual(registry.hasEntry('src/foo'), false);
  });

  test('corrupt provider data returns null from load and creates empty registry', async () => {
    const provider = new InMemoryRegistryProvider();
    // Use corrupt() to simulate data that doesn't survive JSON round-trip
    provider.corrupt();

    const registry = await Registry.create(provider);
    assert.strictEqual(registry.getKeys().length, 0);
  });

  test('adds maintenance notice to existing registry files', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: {},
    });

    const registry = await Registry.create(provider);
    await registry.flush();

    const loaded = await provider.load();
    assert.strictEqual(loaded?.maintenanceNotice, REGISTRY_MAINTENANCE_NOTICE);
  });

  test('normalizes v5 entries by dropping obsolete freshness fields', async () => {
    const provider = new InMemoryRegistryProvider();
    await provider.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      maintenanceNotice: REGISTRY_MAINTENANCE_NOTICE,
      updatedAt: new Date().toISOString(),
      entries: {
        'src/foo': {
          ...makeEntry({
            sourceFactMtimeMs: 1000,
            cognitionMtimeMs: 2000,
            verificationTimeMs: 3000,
          }),
          verifiedAt: '2026-01-01T00:00:00.000Z',
          verifiedSourceBlob: 'old-hash-baseline',
        } as PathKeyRecord & { verifiedAt: string; verifiedSourceBlob: string },
      },
    });

    const registry = await Registry.create(provider);
    const entry = registry.getEntry('src/foo')!;
    assert.strictEqual(entry.sourceFactMtimeMs, undefined);
    assert.strictEqual(entry.cognitionMtimeMs, undefined);
    assert.strictEqual(entry.verificationTimeMs, undefined);
    assert.strictEqual('verifiedAt' in entry, false);
    assert.strictEqual('verifiedSourceBlob' in entry, false);

    await registry.flush();
    const loaded = await provider.load();
    const persisted = loaded!.entries['src/foo'];
    assert.strictEqual('verifiedAt' in persisted, false);
    assert.strictEqual('verifiedSourceBlob' in persisted, false);
  });
});

suite('Registry — CRUD', () => {
  test('setEntry adds entry and is retrievable via getEntry', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    const entry = makeEntry();

    registry.setEntry('src/foo', entry);
    assert.strictEqual(registry.hasEntry('src/foo'), true);
    assert.deepStrictEqual(registry.getEntry('src/foo'), entry);
  });

  test('setEntry overwrites existing entry', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    const entry1 = makeEntry({ sourcePath: 'src/a.ts' });
    const entry2 = makeEntry({ sourcePath: 'src/b.ts' });

    registry.setEntry('src/foo', entry1);
    registry.setEntry('src/foo', entry2);
    const retrieved = registry.getEntry('src/foo')!;
    assert.strictEqual(retrieved.sourcePath, 'src/b.ts');
  });

  test('deleteEntry removes entry', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('src/foo', makeEntry());

    registry.deleteEntry('src/foo');
    assert.strictEqual(registry.hasEntry('src/foo'), false);
    assert.strictEqual(registry.getEntry('src/foo'), undefined);
  });

  test('deleteEntry is no-op for nonexistent key', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    // Should not throw
    registry.deleteEntry('nonexistent');
    assert.strictEqual(registry.getKeys().length, 0);
  });

  test('getEntry returns undefined for missing key', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    assert.strictEqual(registry.getEntry('nonexistent'), undefined);
  });

  test('hasEntry returns false for missing key', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    assert.strictEqual(registry.hasEntry('missing'), false);
  });
});

suite('Registry — dirty flag and flush', () => {
  test('setEntry sets dirty=true, flush resets dirty=false', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    // Capture initial dirty state (private field, so test through flush behavior)
    registry.setEntry('a', makeEntry());
    await registry.flush();

    // After flush, data should be persisted
    const loaded = await provider.load();
    assert.ok(loaded !== null);
    assert.strictEqual(Object.keys(loaded!.entries).length, 1);
  });

  test('flush is no-op when not dirty', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    // Flush without any changes — should not save anything
    await registry.flush();

    const loaded = await provider.load();
    assert.strictEqual(loaded, null);
  });

  test('flush updates updatedAt timestamp', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    registry.setEntry('a', makeEntry());
    const beforeFlush = Date.now();
    await registry.flush();

    const loaded = await provider.load();
    assert.ok(loaded !== null);
    const updatedAt = new Date(loaded!.updatedAt).getTime();
    assert.ok(updatedAt >= beforeFlush, 'updatedAt should be set during flush');
  });

  test('multiple mutations and single flush persists all changes', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    registry.setEntry('a', makeEntry());
    registry.setEntry('b', makeEntry());
    registry.setEntry('c', makeEntry());
    await registry.flush();

    const loaded = await provider.load()!;
    assert.strictEqual(Object.keys(loaded!.entries).length, 3);
  });

  test('rejects a full-file write based on an obsolete loaded revision', async () => {
    const provider = new InMemoryRegistryProvider();
    const first = await Registry.create(provider);
    const second = await Registry.create(provider);

    first.setEntry('first', makeEntry({ sourcePath: 'src/first.ts' }));
    second.setEntry('second', makeEntry({ sourcePath: 'src/second.ts' }));

    await first.flush();
    await assert.rejects(
      second.flush(),
      (error: unknown) => error instanceof RegistryRevisionMismatchError,
    );

    const loaded = await provider.load();
    assert.ok(loaded !== null);
    assert.ok(loaded.entries.first !== undefined);
    assert.strictEqual(loaded.entries.second, undefined);
  });

  test('does not let a stale acceptance overwrite a newer accepted pair', async () => {
    const provider = new InMemoryRegistryProvider();
    const seed = await Registry.create(provider);
    seed.setEntry('src/foo', makeEntry());
    await seed.flush();

    const first = await Registry.create(provider);
    const second = await Registry.create(provider);
    const firstPair = {
      source: `sha256:v1:${'1'.repeat(64)}` as const,
      cognition: `sha256:v1:${'2'.repeat(64)}` as const,
    };
    const secondPair = {
      source: `sha256:v1:${'3'.repeat(64)}` as const,
      cognition: `sha256:v1:${'4'.repeat(64)}` as const,
    };

    first.recordAcceptance('src/foo', firstPair);
    second.recordAcceptance('src/foo', secondPair);

    await first.flush();
    await assert.rejects(
      second.flush(),
      (error: unknown) => error instanceof RegistryRevisionMismatchError,
    );

    const loaded = await provider.load();
    assert.deepStrictEqual(loaded?.entries['src/foo'].accepted, firstPair);
  });
});

suite('Registry — renameKey', () => {
  test('moves entry from old key to new key with same data', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    const entry = makeEntry({ sourcePath: 'src/original.ts' });

    registry.setEntry('old/path', entry);
    const result = registry.renameKey('old/path', 'new/path');

    assert.strictEqual(result, true);
    assert.strictEqual(registry.hasEntry('old/path'), false);
    assert.strictEqual(registry.hasEntry('new/path'), true);
    assert.deepStrictEqual(registry.getEntry('new/path'), entry);
  });

  test('returns false for nonexistent oldKey, no-op', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    const result = registry.renameKey('nonexistent', 'new/path');
    assert.strictEqual(result, false);
    assert.strictEqual(registry.hasEntry('new/path'), false);
  });

  test('returns true for oldKey === newKey, no-op', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    const entry = makeEntry();
    registry.setEntry('same/path', entry);

    const result = registry.renameKey('same/path', 'same/path');
    assert.strictEqual(result, true);
    assert.strictEqual(registry.hasEntry('same/path'), true);
    assert.deepStrictEqual(registry.getEntry('same/path'), entry);
  });

  test('sets dirty flag once (not twice)', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('old', makeEntry());

    // The rename does not cause a double-save on flush
    registry.renameKey('old', 'new');
    await registry.flush();

    const loaded = await provider.load();
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.entries['old'], undefined);
    assert.ok(loaded!.entries['new'] !== undefined);
  });

  test('overwrites existing entry at newKey', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    const oldEntry = makeEntry({ sourcePath: 'src/old.ts' });
    const existingEntry = makeEntry({ sourcePath: 'src/existing.ts' });

    registry.setEntry('old', oldEntry);
    registry.setEntry('new', existingEntry);
    registry.renameKey('old', 'new');

    // old entry's data should now be at 'new'
    assert.deepStrictEqual(registry.getEntry('new'), oldEntry);
  });
});

suite('Registry — freshness times', () => {
  test('records source fact time and auxiliary source fact evidence', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('src/foo', makeEntry());

    registry.recordSourceFactTime('src/foo', 1234, 'abc123hash');

    const entry = registry.getEntry('src/foo')!;
    assert.strictEqual(entry.sourceFactMtimeMs, 1234);
    assert.strictEqual(entry.sourceFactHash, 'abc123hash');
  });

  test('records cognition time and auxiliary cognition cache', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('src/foo', makeEntry());

    registry.recordCognitionTime('src/foo', 4567, 'coghash', 42);

    const entry = registry.getEntry('src/foo')!;
    assert.strictEqual(entry.cognitionMtimeMs, 4567);
    assert.strictEqual(entry.cognitionBlobHash, 'coghash');
    assert.strictEqual(entry.cognitionLength, 42);
  });

  test('records explicit verification time', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('src/foo', makeEntry());

    registry.recordExplicitVerification('src/foo', 7890);

    const entry = registry.getEntry('src/foo')!;
    assert.strictEqual(entry.verificationTimeMs, 7890);
    assert.deepStrictEqual(registry.getFreshnessTimes('src/foo'), {
      sourceFactMtimeMs: null,
      cognitionMtimeMs: null,
      verificationTimeMs: 7890,
      sourceFactHash: null,
    });
  });

  test('recording freshness facts is no-op for nonexistent key', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);

    // Should not throw
    registry.recordSourceFactTime('nonexistent', 1234);
    registry.recordCognitionTime('nonexistent', 1234);
    registry.recordExplicitVerification('nonexistent', 1234);
    assert.strictEqual(registry.getKeys().length, 0);
  });

  test('recording freshness facts marks registry dirty', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry());

    registry.recordExplicitVerification('a', 1234);
    await registry.flush();

    const loaded = await provider.load();
    assert.ok(loaded !== null);
    assert.strictEqual(loaded!.entries['a'].verificationTimeMs, undefined);
  });
});

suite('Registry — getAllEntries', () => {
  test('returns shallow clone that can be mutated without affecting internal state', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts' }));

    const entries = registry.getAllEntries();
    entries['b'] = makeEntry(); // Mutate the clone

    assert.strictEqual(registry.hasEntry('b'), false); // Internal state unchanged
  });

  test('returns all entries', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry());
    registry.setEntry('b', makeEntry());

    const entries = registry.getAllEntries();
    assert.strictEqual(Object.keys(entries).length, 2);
    assert.ok('a' in entries);
    assert.ok('b' in entries);
  });
});

suite('Registry — getEntriesBySourcePath', () => {
  test('finds entries referencing a source path', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts' }));
    registry.setEntry('b', makeEntry({ sourcePath: 'src/b.ts' }));

    const matches = registry.getEntriesBySourcePath('src/a.ts');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].sourcePath, 'src/a.ts');
  });

  test('finds keys and records referencing a source path', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts' }));
    registry.setEntry('b', makeEntry({ sourcePath: 'src/b.ts' }));

    assert.deepStrictEqual(registry.getKeysBySourcePath('src/a.ts'), ['a']);

    const matches = registry.getRecordsBySourcePath('src/a.ts');
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0].key, 'a');
    assert.strictEqual(matches[0].record.sourcePath, 'src/a.ts');
  });

  test('returns empty array when no entry references the source path', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts' }));

    const matches = registry.getEntriesBySourcePath('src/missing.ts');
    assert.deepStrictEqual(matches, []);
    assert.deepStrictEqual(registry.getKeysBySourcePath('src/missing.ts'), []);
    assert.deepStrictEqual(registry.getRecordsBySourcePath('src/missing.ts'), []);
  });
});

suite('Registry — getKeys', () => {
  test('returns all keys', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    registry.setEntry('a', makeEntry());
    registry.setEntry('b', makeEntry());
    registry.setEntry('c', makeEntry());

    const keys = registry.getKeys();
    assert.strictEqual(keys.length, 3);
    assert.ok(keys.includes('a'));
    assert.ok(keys.includes('b'));
    assert.ok(keys.includes('c'));
  });

  test('returns empty array for empty registry', async () => {
    const provider = new InMemoryRegistryProvider();
    const registry = await Registry.create(provider);
    assert.deepStrictEqual(registry.getKeys(), []);
  });
});

suite('Registry — persistence round-trip', () => {
  test('entries survive create → setEntry → flush → create cycle', async () => {
    const provider = new InMemoryRegistryProvider();
    const entry = makeEntry({
      sourcePath: 'src/foo.ts',
      verificationTimeMs: 1234,
      cognitionBlobHash: 'coghash',
      cognitionLength: 250,
    });

    // First session
    const registry1 = await Registry.create(provider);
    registry1.setEntry('src/foo', entry);
    await registry1.flush();

    // Second session (new instance loading saved data)
    const registry2 = await Registry.create(provider);
    assert.strictEqual(registry2.hasEntry('src/foo'), true);
    const loaded = registry2.getEntry('src/foo');
    assert.strictEqual(loaded?.sourcePath, 'src/foo.ts');
    assert.strictEqual(loaded?.verificationTimeMs, undefined);
    assert.strictEqual(loaded?.cognitionBlobHash, 'coghash');
    assert.strictEqual(loaded?.cognitionLength, 250);
  });

  test('folder entries persist correctly', async () => {
    const provider = new InMemoryRegistryProvider();
    const entry = makeFolderEntry({ sourcePath: 'src' });

    const registry1 = await Registry.create(provider);
    registry1.setEntry('src/', entry);
    await registry1.flush();

    const registry2 = await Registry.create(provider);
    assert.strictEqual(registry2.hasEntry('src/'), true);
    const loaded = registry2.getEntry('src/')!;
    assert.strictEqual(loaded.type, 'folder');
  });
});

suite('Registry — trace logging', () => {
  test('logs sourcePath tracking mutations only', async () => {
    const events: CoggitLogEvent[] = [];
    const registry = await Registry.create(new InMemoryRegistryProvider(), {
      logger: { log: (event) => events.push(event) },
    });

    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts' }), 'test.add');
    registry.setEntry('a', makeEntry({ sourcePath: 'src/a.ts', cognitionLength: 10 }), 'test.cache');
    registry.setEntry('a', makeEntry({ sourcePath: 'src/b.ts' }), 'test.source');
    registry.renameKey('a', 'b', 'test.rename');
    registry.deleteEntry('b', 'test.delete');

    assert.deepStrictEqual(
      events.map((event) => event.message),
      ['entry-add', 'sourcePath-change', 'key-rename', 'entry-delete'],
    );
    assert.deepStrictEqual(
      events.map((event) => event.data?.source),
      ['test.add', 'test.source', 'test.rename', 'test.delete'],
    );
  });
});
