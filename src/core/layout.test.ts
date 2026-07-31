import * as assert from 'node:assert';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  RegistryProviderFactory,
  UriComponents,
} from './interfaces';
import type { CoggitWorkspaceRoot, PathKeyRecord, RegistryFile } from './types';
import { detectMisplacedCognitionEntries } from './layout';
import { createCoggitServices, openCoggitProject } from './project';
import { REGISTRY_SCHEMA_VERSION } from './registry/index';

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
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dirPath = '/' + parts.slice(0, i).join('/');
      if (!this.entries.has(dirPath)) {
        this.addDirectory(dirPath, mtimeMs);
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

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    this.addFile(uri.path, content);
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    const entry = this.entries.get(uri.path);
    return entry
      ? { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs }
      : undefined;
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const dirPath = uri.path.endsWith('/') ? uri.path : uri.path + '/';
    const children: Array<[string, number]> = [];
    for (const [path, entry] of this.entries) {
      if (path === uri.path || !path.startsWith(dirPath)) {
        continue;
      }

      const rest = path.slice(dirPath.length);
      if (rest.length > 0 && !rest.includes('/')) {
        children.push([rest, entry.isDirectory ? 2 : 1]);
      }
    }
    return children.sort(([left], [right]) => left.localeCompare(right));
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return this.entries.has(uri.path);
  }

  async createDirectory(uri: UriComponents): Promise<void> {
    this.addDirectory(uri.path);
  }

  async delete(uri: UriComponents): Promise<void> {
    this.entries.delete(uri.path);
  }
}

class MockConfigProvider implements ConfigProvider {
  getWorkspaceFolders() {
    return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
  }

  async findFiles(_pattern: string): Promise<UriComponents[]> {
    return [];
  }
}

class CountingRegistryProvider {
  saveCount = 0;

  constructor(private data: RegistryFile | null) {}

  async load(): Promise<RegistryFile | null> {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async save(file: RegistryFile): Promise<void> {
    this.saveCount++;
    this.data = JSON.parse(JSON.stringify(file));
  }
}

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
    sourceRootUri: uri('/workspace/src'),
    cognitionRootUri: uri('/workspace/cognition'),
  };
}

function makeEntry(overrides: Partial<PathKeyRecord> = {}): PathKeyRecord {
  return {
    sourcePath: 'src/new/foo.ts',
    type: 'leaf',
    sourceFactMtimeMs: null,
    cognitionMtimeMs: null,
    verificationTimeMs: null,
    createdAt: null,
    sourceFactHash: null,
    cognitionBlobHash: null,
    cognitionLength: null,
    ...overrides,
  };
}

function makeRegistryFile(entries: Record<string, PathKeyRecord>): RegistryFile {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: '2026-07-14T00:00:00.000Z',
    entries,
  };
}

suite('layout — detectMisplacedCognitionEntries', () => {
  test('reports registry-linked cognition whose actual path differs from expected path', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/new/foo.ts', 'source');
    fs.addFile('/workspace/cognition/old/foo.ts.md', 'cognition');

    const result = await detectMisplacedCognitionEntries(
      makeRoot(),
      fs,
      {
        'old/foo.ts': makeEntry(),
      },
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].registryKey, 'old/foo.ts');
    assert.strictEqual(result[0].sourcePath, 'src/new/foo.ts');
    assert.strictEqual(result[0].sourceUri.path, '/workspace/src/new/foo.ts');
    assert.strictEqual(result[0].actualCognitionPath, 'cognition/old/foo.ts.md');
    assert.strictEqual(result[0].actualCognitionUri.path, '/workspace/cognition/old/foo.ts.md');
    assert.strictEqual(result[0].expectedCognitionPath, 'cognition/new/foo.ts.md');
    assert.strictEqual(result[0].expectedCognitionUri.path, '/workspace/cognition/new/foo.ts.md');
  });

  test('does not report when actual path equals expected path', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/new/foo.ts', 'source');
    fs.addFile('/workspace/cognition/new/foo.ts.md', 'cognition');

    const result = await detectMisplacedCognitionEntries(
      makeRoot(),
      fs,
      {
        'new/foo': makeEntry({
          sourcePath: 'src/new/foo.ts',
        }),
      },
    );

    assert.deepStrictEqual(result, []);
  });

  test('does not report when source is missing', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/cognition/old/foo.ts.md', 'cognition');

    const result = await detectMisplacedCognitionEntries(
      makeRoot(),
      fs,
      {
        'old/foo.ts': makeEntry(),
      },
    );

    assert.deepStrictEqual(result, []);
  });

  test('does not report when cognition is missing', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/new/foo.ts', 'source');

    const result = await detectMisplacedCognitionEntries(
      makeRoot(),
      fs,
      {
        'old/foo.ts': makeEntry(),
      },
    );

    assert.deepStrictEqual(result, []);
  });

  test('handles folder entries and empty sourcePath', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/src/new/folder');
    fs.addFile('/workspace/cognition/old/folder/README.md', 'cognition');

    const result = await detectMisplacedCognitionEntries(
      makeRoot(),
      fs,
      {
        'old/folder/': makeEntry({
          sourcePath: 'src/new/folder',
          type: 'folder',
        }),
        empty: makeEntry({ sourcePath: null }),
      },
    );

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].type, 'folder');
    assert.strictEqual(result[0].expectedCognitionPath, 'cognition/new/folder/README.md');
  });
});

suite('project — listMisplacedCognition', () => {
  test('returns registry-backed orphaned cognition without scanning for unregistered files', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/missing.ts.md', 'cognition');
    fs.addFile('/workspace/cognition/unregistered.ts.md', 'cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'missing.ts': makeEntry({
        sourcePath: 'src/missing.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    const saveCountAfterOpen = provider.saveCount;

    const result = await project.listOrphanedCognition();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].registryKey, 'missing.ts');
    assert.strictEqual(result[0].sourcePath, 'src/missing.ts');
    assert.strictEqual(provider.saveCount, saveCountAfterOpen);
  });

  test('returns misplaced cognition from project runtime registry', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/new/foo.ts', 'source');
    fs.addFile('/workspace/cognition/old/foo.ts.md', 'cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'old/foo.ts': makeEntry(),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    const saveCountAfterOpen = provider.saveCount;

    const result = await project.listMisplacedCognition();

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].registryKey, 'old/foo.ts');
    assert.strictEqual(provider.saveCount, saveCountAfterOpen);
  });

  test('resolves empty sourcePath from mirror layout and saves project-relative path', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/foo.ts', 'source');
    fs.addFile('/workspace/cognition/foo.ts.md', 'cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'foo.ts': makeEntry({
        sourcePath: null,
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    await openCoggitProject(services, makeRoot());

    const saved = await provider.load();
    assert.strictEqual(saved?.entries['foo.ts'].sourcePath, 'src/foo.ts');
  });

  test('returns empty list when registry is unavailable', async () => {
    const fs = new MockFileSystem();
    const services = createCoggitServices(fs, new MockConfigProvider());
    const project = await openCoggitProject(services, makeRoot());

    const result = await project.listMisplacedCognition();

    assert.deepStrictEqual(result, []);
  });
});
