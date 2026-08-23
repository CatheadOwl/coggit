import * as assert from 'node:assert';
import { REGISTRY_SCHEMA_VERSION, Registry } from './index';
import { InMemoryRegistryProvider } from './inMemoryRegistryProvider';
import type { RegistryFile, RegistryProvider } from '../types';
import { computeBlobHash } from '../hash';
import {
  scanCognitionDirectory,
  reconcileRegistry,
} from './reconcile';
import type { PathKeyRecord } from '../types';
import type { FileSystem, FileStat, UriComponents } from '../interfaces';

// ─── Mock FileSystem ────────────────────────────────────────────────────────

interface MockFileEntry {
  isDirectory: boolean;
  content: string;
  mtimeMs: number;
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, MockFileEntry>();

  addDirectory(path: string, mtimeMs = 1000): void {
    this.entries.set(path, { isDirectory: true, content: '', mtimeMs });
  }

  addFile(path: string, content: string, mtimeMs = 1000): void {
    this.entries.set(path, { isDirectory: false, content, mtimeMs });
    // Ensure parent directory entries exist
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dirPath = '/' + parts.slice(0, i).join('/');
      if (!this.entries.has(dirPath)) {
        this.entries.set(dirPath, { isDirectory: true, content: '', mtimeMs: 0 });
      }
    }
  }

  async readFile(uri: UriComponents): Promise<string> {
    const entry = this.entries.get(uri.path);
    if (!entry || entry.isDirectory) {
      throw new Error('ENOENT');
    }
    return entry.content;
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    const entry = this.entries.get(uri.path);
    if (!entry) { return undefined; }
    return { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs };
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const dirPath = uri.path.endsWith('/') ? uri.path : uri.path + '/';
    const children: Array<[string, number]> = [];
    for (const [key, entry] of this.entries) {
      if (key === uri.path) { continue; }
      if (key.startsWith(dirPath)) {
        const rest = key.slice(dirPath.length);
        if (rest.length > 0 && !rest.includes('/')) {
          children.push([rest, entry.isDirectory ? 2 : 1]);
        }
      }
    }
    return children.sort(([a], [b]) => a.localeCompare(b));
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return this.entries.has(uri.path);
  }

  async writeFile(_uri: UriComponents, _content: string): Promise<void> {
    // no-op
  }

  async createDirectory(_uri: UriComponents): Promise<void> {
    // no-op
  }

  async delete(uri: UriComponents): Promise<void> {
    this.entries.delete(uri.path);
  }
}

function cogUri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

// ─── Test helpers ───────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<PathKeyRecord> = {}): PathKeyRecord {
  return {
    sourcePath: null,
    type: 'leaf',
    accepted: null,
    ...overrides,
  };
}

async function createRegistry(entries: Record<string, PathKeyRecord>): Promise<Registry> {
  const provider = new InMemoryRegistryProvider();
  const registry = await Registry.create(provider);
  // Seed entries directly in-memory to preserve hash cache fields for reconcile
  for (const [key, entry] of Object.entries(entries)) {
    registry.setEntry(key, entry);
  }
  return registry;
}

/** Counting provider wrapper to assert save call count. */
function createCountingProvider() {
  const inner = new InMemoryRegistryProvider();
  let saveCount = 0;
  const provider: RegistryProvider & { saveCount: number; inner: InMemoryRegistryProvider } = {
    get saveCount() { return saveCount; },
    get inner() { return inner; },
    async load() { return inner.load(); },
    async save(file: RegistryFile) {
      saveCount++;
      return inner.save(file);
    },
  };
  return provider;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

suite('reconcile — scanCognitionDirectory', () => {
  test('walks subdirectories and computes SHA256 for .md files', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'content A');
    fs.addFile('/cog/sub/b.ts.md', 'content B');
    fs.addFile('/cog/sub/c.ts.md', 'content C');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));

    assert.strictEqual(scan.size, 3);
    assert.ok(scan.has('a.ts'));
    assert.ok(scan.has('sub/b.ts'));
    assert.ok(scan.has('sub/c.ts'));
  });

  test('skips non-.md files', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/cog/foo.ts.md', 'cognition for foo.ts');
    fs.addFile('/cog/bar.txt', 'not cognition');
    fs.addFile('/cog/baz.json', 'not cognition');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));

    assert.strictEqual(scan.size, 1);
    assert.ok(scan.has('foo.ts'));
  });

  test('skips unreadable files gracefully', async () => {
    const fs = new MockFileSystem();
    // Only add a directory; no files
    fs.addDirectory('/cog');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    assert.strictEqual(scan.size, 0);
  });

  test('computes contentHash and contentLength correctly', async () => {
    const fs = new MockFileSystem();
    const content = 'some cognition content';
    fs.addFile('/cog/foo.ts.md', content);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const info = scan.get('foo.ts')!;

    assert.strictEqual(info.contentHash, computeBlobHash(content));
    assert.strictEqual(info.contentLength, content.length);
    assert.strictEqual(info.path, 'foo.ts.md');
    assert.ok(info.mtimeMs > 0);
  });

  test('handles README.md as root key', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/cog/README.md', '# Root');
    fs.addFile('/cog/sub/README.md', '# Sub');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));

    assert.strictEqual(scan.size, 2);
    assert.ok(scan.has('/'));
    assert.ok(scan.has('sub/'));
  });

  test('skips free-form cognition files without source extension', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/cog/CODE_MAP.md', '# Code Map');
    fs.addFile('/cog/MODULES.md', '# Modules');
    fs.addFile('/cog/sub/INDEX.md', '# Index');
    fs.addFile('/cog/types.ts.md', 'tracked cognition');
    fs.addFile('/cog/README.md', '# Root');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));

    assert.strictEqual(scan.size, 2);
    assert.ok(scan.has('types.ts'));
    assert.ok(scan.has('/'));
    assert.ok(!scan.has('CODE_MAP'));
    assert.ok(!scan.has('MODULES'));
    assert.ok(!scan.has('sub/INDEX'));
  });
});

suite('reconcile — reconcileRegistry (full integration)', () => {
  test('added detection: empty registry + 3 cognition files', async () => {
    const registry = await createRegistry({});
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'content A');
    fs.addFile('/cog/sub/b.ts.md', 'content B');
    fs.addFile('/cog/c.ts.md', 'content C');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.added.length, 3);
    assert.ok(diff.added.includes('a.ts'));
    assert.ok(diff.added.includes('sub/b.ts'));
    assert.ok(diff.added.includes('c.ts'));
    assert.strictEqual(diff.deleted.length, 0);

    // Verify entries were added to registry
    assert.ok(registry.hasEntry('a.ts'));
    assert.ok(registry.hasEntry('sub/b.ts'));
    assert.ok(registry.hasEntry('c.ts'));
  });

  test('deleted detection: registry has entries, no cognition files', async () => {
    const registry = await createRegistry({
      'a': makeEntry(),
      'b': makeEntry(),
    });
    const fs = new MockFileSystem();
    fs.addDirectory('/cog');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.deleted.length, 2);
    assert.ok(diff.deleted.includes('a'));
    assert.ok(diff.deleted.includes('b'));
    assert.strictEqual(diff.added.length, 0);
  });

  test('cognition move appears as delete + add, no rename tracking', async () => {
    const registry = await createRegistry({
      'old/path.ts': makeEntry({ sourcePath: 'src/old.ts' }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/new/path.ts.md', 'some content');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.deleted.length, 1);
    assert.strictEqual(diff.deleted[0], 'old/path.ts');
    assert.strictEqual(diff.added.length, 1);
    assert.strictEqual(diff.added[0], 'new/path.ts');
  });

  test('intersection produces no structural diff entries', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry(),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'content');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.deleted.length, 0);
  });

  test('first encounter produces no structural diff entries and writes no cache', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry(),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'content');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.deleted.length, 0);

    // Entry should only have semantic fields
    const entry = registry.getEntry('a.ts')!;
    assert.strictEqual(entry.cognitionBlobHash ?? null, null);
    assert.strictEqual(entry.cognitionLength ?? null, null);
  });

  test('v6 canonical registry with unchanged cognition does not trigger save', async () => {
    const provider = createCountingProvider();
    await provider.inner.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      maintenanceNotice: 'This file is auto-maintained CogGit metadata. Ignore routine changes; it is committed so metadata can be located across hosts. Direct reads may be stale; use CogGit commands or MCP tools for authoritative freshness.',
      entries: {
        'a.ts': {
          sourcePath: 'src/a.ts',
          type: 'leaf',
          accepted: null,
        },
      },
    });
    const registry = await Registry.create(provider);
    const savesAfterCreate = provider.saveCount;

    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'content');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    await reconcileRegistry(registry, scan);
    await registry.flush();

    // saveCount should not have increased since Registry.create
    assert.strictEqual(provider.saveCount, savesAfterCreate);

    // The loaded entry should still have no cache fields
    const loaded = await provider.inner.load();
    const entry = loaded!.entries['a.ts'];
    assert.strictEqual('cognitionBlobHash' in entry, false);
    assert.strictEqual('cognitionLength' in entry, false);
  });

  test('empty registry + empty cognition directory = empty diff', async () => {
    const registry = await createRegistry({});
    const fs = new MockFileSystem();
    fs.addDirectory('/cog');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.deleted.length, 0);
    assert.strictEqual(diff.stats.totalScanned, 0);
    assert.strictEqual(diff.stats.totalRegistryEntries, 0);
  });

  test('stats counters accurate', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry(),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', 'unchanged');
    fs.addFile('/cog/b.ts.md', 'added');

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.stats.totalScanned, 2);
    assert.strictEqual(diff.stats.totalRegistryEntries, 1);
  });
});
