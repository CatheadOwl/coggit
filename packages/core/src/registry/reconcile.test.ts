import * as assert from 'node:assert';
import { REGISTRY_SCHEMA_VERSION, Registry } from './index';
import { InMemoryRegistryProvider } from './inMemoryRegistryProvider';
import { computeBlobHash } from '../hash';
import {
  scanCognitionDirectory,
  pairDeletedToAdded,
  reconcileRegistry,
  type CognitionDirScan,
  type CognitionFileScanInfo,
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

/** Content longer than MIN_RENAME_PAIRING_LENGTH (100 chars) to qualify for rename pairing. */
function longContent(content: string, minLength = 120): string {
  while (content.length < minLength) {
    content += content;
  }
  return content.slice(0, minLength);
}

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

function emptyScan(): CognitionDirScan {
  return new Map();
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

suite('reconcile — pairDeletedToAdded', () => {
  const longA = longContent('content for A');
  const longB = longContent('content for B');
  const hashA = computeBlobHash(longA);
  const hashB = computeBlobHash(longB);

  test('pairs identical content (hash + length match, length > 100)', () => {
    const added: CognitionDirScan = new Map([
      ['b', { path: 'b.md', mtimeMs: 1000, contentHash: hashA, contentLength: longA.length }],
    ]);
    const deleted = new Map<string, PathKeyRecord>([
      ['a', makeEntry({ cognitionBlobHash: hashA, cognitionLength: longA.length })],
    ]);

    const pairs = pairDeletedToAdded(added, deleted);
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].from, 'a');
    assert.strictEqual(pairs[0].to, 'b');
  });

  test('skips pairing when content length <= 100 (MIN_RENAME_PAIRING_LENGTH)', () => {
    const shortContent = 'short';
    const shortHash = computeBlobHash(shortContent);

    const added: CognitionDirScan = new Map([
      ['b', { path: 'b.md', mtimeMs: 1000, contentHash: shortHash, contentLength: shortContent.length }],
    ]);
    const deleted = new Map<string, PathKeyRecord>([
      ['a', makeEntry({ cognitionBlobHash: shortHash, cognitionLength: shortContent.length })],
    ]);

    const pairs = pairDeletedToAdded(added, deleted);
    assert.strictEqual(pairs.length, 0);
  });

  test('skips pairing when content hash does not match', () => {
    const added: CognitionDirScan = new Map([
      ['b', { path: 'b.md', mtimeMs: 1000, contentHash: hashB, contentLength: longB.length }],
    ]);
    const deleted = new Map<string, PathKeyRecord>([
      ['a', makeEntry({ cognitionBlobHash: hashA, cognitionLength: longA.length })],
    ]);

    const pairs = pairDeletedToAdded(added, deleted);
    assert.strictEqual(pairs.length, 0);
  });

  test('first-match wins: same content, only first added entry paired', () => {
    const added: CognitionDirScan = new Map([
      ['c', { path: 'c.md', mtimeMs: 1000, contentHash: hashA, contentLength: longA.length }],
      ['d', { path: 'd.md', mtimeMs: 1000, contentHash: hashA, contentLength: longA.length }],
    ]);
    const deleted = new Map<string, PathKeyRecord>([
      ['a', makeEntry({ cognitionBlobHash: hashA, cognitionLength: longA.length })],
      ['b', makeEntry({ cognitionBlobHash: hashB, cognitionLength: longB.length })],
    ]);

    const pairs = pairDeletedToAdded(added, deleted);
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].from, 'a');
    assert.strictEqual(pairs[0].to, 'c');
  });

  test('chain rename: A→B→C only finds B→C, A metadata lost', () => {
    const hashC = computeBlobHash('content C');
    const contentC = longContent('content C');

    const added: CognitionDirScan = new Map([
      ['c', { path: 'c.md', mtimeMs: 1000, contentHash: hashB, contentLength: longB.length }],
    ]);
    const deleted = new Map<string, PathKeyRecord>([
      ['a', makeEntry({ cognitionBlobHash: hashA, cognitionLength: longA.length })],
      ['b', makeEntry({ cognitionBlobHash: hashB, cognitionLength: longB.length })],
    ]);

    const pairs = pairDeletedToAdded(added, deleted);
    // B→C found (B's hash matches C's content), but A→? not found
    assert.strictEqual(pairs.length, 1);
    assert.strictEqual(pairs[0].from, 'b');
    assert.strictEqual(pairs[0].to, 'c');
  });
});

suite('reconcile — reconcileRegistry (full integration)', () => {
  const CONTENT_A = longContent('alpha content');
  const CONTENT_B = longContent('beta content');
  const CONTENT_C = longContent('gamma content');
  const HASH_A = computeBlobHash(CONTENT_A);
  const HASH_B = computeBlobHash(CONTENT_B);
  const HASH_C = computeBlobHash(CONTENT_C);

  test('added detection: empty registry + 3 cognition files', async () => {
    const registry = await createRegistry({});
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', CONTENT_A);
    fs.addFile('/cog/sub/b.ts.md', CONTENT_B);
    fs.addFile('/cog/c.ts.md', CONTENT_C);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.added.length, 3);
    assert.ok(diff.added.includes('a.ts'));
    assert.ok(diff.added.includes('sub/b.ts'));
    assert.ok(diff.added.includes('c.ts'));
    assert.strictEqual(diff.deleted.length, 0);
    assert.strictEqual(diff.renamed.length, 0);
    assert.strictEqual(diff.updated.length, 0);
    assert.strictEqual(diff.unchanged.length, 0);

    // Verify entries were added to registry
    assert.ok(registry.hasEntry('a.ts'));
    assert.ok(registry.hasEntry('sub/b.ts'));
    assert.ok(registry.hasEntry('c.ts'));
  });

  test('deleted detection: registry has entries, no cognition files', async () => {
    const registry = await createRegistry({
      'a': makeEntry({ cognitionBlobHash: HASH_A, cognitionLength: CONTENT_A.length }),
      'b': makeEntry({ cognitionBlobHash: HASH_B, cognitionLength: CONTENT_B.length }),
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

  test('rename match: same content, length > 100, metadata migrates', async () => {
    const registry = await createRegistry({
      'old/path.ts': makeEntry({
        sourcePath: 'src/old.ts',
        cognitionBlobHash: HASH_A,
        cognitionLength: CONTENT_A.length,
      }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/new/path.ts.md', CONTENT_A);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.renamed.length, 1);
    assert.strictEqual(diff.renamed[0].from, 'old/path.ts');
    assert.strictEqual(diff.renamed[0].to, 'new/path.ts');

    // Verify metadata migrated (sourcePath preserved)
    const entry = registry.getEntry('new/path.ts')!;
    assert.strictEqual(entry.sourcePath, 'src/old.ts');
    assert.strictEqual(entry.cognitionBlobHash, HASH_A);
    assert.strictEqual(entry.cognitionLength, CONTENT_A.length);

    // Old key gone
    assert.strictEqual(registry.hasEntry('old/path.ts'), false);
  });

  test('rename skip: content length <= 100 (false positive protection)', async () => {
    const shortContent = '# Short';
    const shortHash = computeBlobHash(shortContent);

    const registry = await createRegistry({
      'old/path.ts': makeEntry({
        cognitionBlobHash: shortHash,
        cognitionLength: shortContent.length,
      }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/new/path.ts.md', shortContent);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.renamed.length, 0);
    // old/path.ts should be deleted (true deletion) because it wasn't renamed
    assert.ok(diff.deleted.includes('old/path.ts'));
  });

  test('rename skip: content hash mismatch', async () => {
    const registry = await createRegistry({
      'old/path.ts': makeEntry({
        cognitionBlobHash: HASH_A,
        cognitionLength: CONTENT_A.length,
      }),
    });
    const fs = new MockFileSystem();
    // Different content
    fs.addFile('/cog/new/path.ts.md', CONTENT_B);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.renamed.length, 0);
    assert.ok(diff.deleted.includes('old/path.ts'));
    assert.ok(diff.added.includes('new/path.ts'));
  });

  test('intersection unchanged (same hash, same length)', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry({
        cognitionBlobHash: HASH_A,
        cognitionLength: CONTENT_A.length,
      }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', CONTENT_A);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.unchanged.length, 1);
    assert.strictEqual(diff.unchanged[0], 'a.ts');
    assert.strictEqual(diff.updated.length, 0);
    assert.strictEqual(diff.added.length, 0);
    assert.strictEqual(diff.deleted.length, 0);
  });

  test('intersection updated (different hash, same key)', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry({
        cognitionBlobHash: HASH_A,
        cognitionLength: CONTENT_A.length,
      }),
    });
    const fs = new MockFileSystem();
    // File still at 'a.ts', but content changed
    fs.addFile('/cog/a.ts.md', CONTENT_B);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.updated.length, 1);
    assert.strictEqual(diff.updated[0], 'a.ts');
    assert.strictEqual(diff.unchanged.length, 0);

    // Registry should have updated hash cache
    const entry = registry.getEntry('a.ts')!;
    assert.strictEqual(entry.cognitionBlobHash, HASH_B);
    assert.strictEqual(entry.cognitionLength, CONTENT_B.length);
  });

  test('first encounter does not dirty registry and is reported as unchanged', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry({
        cognitionBlobHash: null, // No prior hash — first encounter
        cognitionLength: null,
      }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', CONTENT_A);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    // First encounter should be unchanged (not updated)
    assert.strictEqual(diff.unchanged.length, 1);
    assert.strictEqual(diff.unchanged[0], 'a.ts');
    assert.strictEqual(diff.updated.length, 0);

    // Hash cache should NOT be written back — registry stays clean for flush
    const entry = registry.getEntry('a.ts')!;
    assert.strictEqual(entry.cognitionBlobHash ?? null, null);
    assert.strictEqual(entry.cognitionLength ?? null, null);
  });

  test('v6 canonical registry with unchanged cognition does not trigger save', async () => {
    // Seed a canonical v6 registry: only sourcePath, type, accepted — no cache fields
    const provider = new InMemoryRegistryProvider();
    await provider.save({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      entries: {
        'a.ts': {
          sourcePath: 'src/a.ts',
          type: 'leaf',
          accepted: null,
        },
      },
    });
    const registry = await Registry.create(provider);

    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', CONTENT_A);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    // No updated keys — content hasn't semantically changed
    assert.strictEqual(diff.updated.length, 0);
    assert.strictEqual(diff.unchanged.length, 1);

    // Flush should be a no-op: no semantic mutation means no save
    await registry.flush();
    const loaded = await provider.load();
    // The loaded entry should still have no cache fields
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
    assert.strictEqual(diff.renamed.length, 0);
    assert.strictEqual(diff.updated.length, 0);
    assert.strictEqual(diff.unchanged.length, 0);
    assert.strictEqual(diff.stats.totalScanned, 0);
    assert.strictEqual(diff.stats.totalRegistryEntries, 0);
  });

  test('chain rename integrates through full reconcile', async () => {
    // Registry has entries A and B
    const registry = await createRegistry({
      'a.ts': makeEntry({
        sourcePath: 'src/a.ts',
        cognitionBlobHash: HASH_A,
        cognitionLength: CONTENT_A.length,
      }),
      'b.ts': makeEntry({
        sourcePath: 'src/b.ts',
        cognitionBlobHash: HASH_B,
        cognitionLength: CONTENT_B.length,
      }),
    });

    // On disk: only c.ts.md exists (with B's content). A's content is gone.
    const fs = new MockFileSystem();
    fs.addFile('/cog/c.ts.md', CONTENT_B);

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    // Only B→C rename should be detected
    assert.strictEqual(diff.renamed.length, 1);
    assert.strictEqual(diff.renamed[0].from, 'b.ts');
    assert.strictEqual(diff.renamed[0].to, 'c.ts');

    // A should be deleted
    assert.strictEqual(diff.deleted.length, 1);
    assert.strictEqual(diff.deleted[0], 'a.ts');

    // B's metadata should have migrated to C
    const entryC = registry.getEntry('c.ts')!;
    assert.strictEqual(entryC.sourcePath, 'src/b.ts');
  });

  test('stats counters accurate', async () => {
    const registry = await createRegistry({
      'a.ts': makeEntry({ cognitionBlobHash: HASH_A, cognitionLength: CONTENT_A.length }),
    });
    const fs = new MockFileSystem();
    fs.addFile('/cog/a.ts.md', CONTENT_A); // unchanged
    fs.addFile('/cog/b.ts.md', CONTENT_B); // added

    const scan = await scanCognitionDirectory(fs, cogUri('/cog'));
    const diff = await reconcileRegistry(registry, scan);

    assert.strictEqual(diff.stats.totalScanned, 2);
    assert.strictEqual(diff.stats.totalRegistryEntries, 1);
    assert.strictEqual(diff.stats.renamePairsFound, 0);
  });
});
