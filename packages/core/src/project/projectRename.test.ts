import * as assert from 'node:assert';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  RegistryProviderFactory,
  UriComponents,
} from '../interfaces';
import type { CoggitWorkspaceRoot, PathKeyRecord, RegistryFile } from '../types';
import { createCoggitServices, openCoggitProject } from './project';
import { REGISTRY_SCHEMA_VERSION } from '../registry/index';
import { computeBlobHash } from '../hash';

interface MockFileEntry {
  isDirectory: boolean;
  content: string;
  mtimeMs: number;
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, MockFileEntry>();
  readFileCount = 0;
  readDirectoryCalls: string[] = [];

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
    this.readFileCount++;
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
    this.readDirectoryCalls.push(uri.path);
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

  remove(path: string): void {
    this.entries.delete(path);
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
  private nextLoadMutation: ((file: RegistryFile) => RegistryFile) | undefined;

  constructor(private data: RegistryFile | null) {}

  async load(): Promise<RegistryFile | null> {
    if (this.data && this.nextLoadMutation) {
      this.data = this.nextLoadMutation(JSON.parse(JSON.stringify(this.data)));
      this.nextLoadMutation = undefined;
    }
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async save(file: RegistryFile): Promise<void> {
    this.saveCount++;
    this.data = JSON.parse(JSON.stringify(file));
  }

  mutateOnNextLoad(mutation: (file: RegistryFile) => RegistryFile): void {
    this.nextLoadMutation = mutation;
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
    ...overrides,
  };
}

function makeRegistryFile(entries: Record<string, PathKeyRecord>): RegistryFile {
  return {
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    entries,
  };
}

suite('project — source rename tracking', () => {
  test('updates registry sourcePath records when a source folder is renamed', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addDirectory('/workspace/src/watch');
    fs.addFile('/workspace/src/watch/index.ts', 'source index');
    fs.addDirectory('/workspace/src/vscode/watch');
    fs.addFile('/workspace/src/vscode/watch/index.ts', 'source index');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');
    fs.addFile('/workspace/cognition/watch/index.ts.md', 'cognition index');
    fs.addFile('/workspace/src/watcher/foo.ts', 'nearby source');
    fs.addFile('/workspace/cognition/watcher/foo.ts.md', 'nearby cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
      'watch/index.ts': makeEntry({
        sourcePath: 'src/watch/index.ts',
      }),
      'watcher/foo.ts': makeEntry({
        sourcePath: 'src/watcher/foo.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch'),
      uri('/workspace/src/vscode/watch'),
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].sourcePath, 'src/vscode/watch');
    assert.strictEqual(saved?.entries['watch/index.ts'].sourcePath, 'src/vscode/watch/index.ts');
    assert.strictEqual(saved?.entries['watcher/foo.ts'].sourcePath, 'src/watcher/foo.ts');
  });

  test('updates folder records when VS Code reports a directory move as a child file rename', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addDirectory('/workspace/src/watch');
    fs.addFile('/workspace/src/watch/watcher.ts', 'source watcher');
    fs.addDirectory('/workspace/src/vscode/watch');
    fs.addFile('/workspace/src/vscode/watch/watcher.ts', 'source watcher');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    fs.remove('/workspace/src/watch');
    fs.remove('/workspace/src/watch/watcher.ts');

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch/watcher.ts'),
      uri('/workspace/src/vscode/watch/watcher.ts'),
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].sourcePath, 'src/vscode/watch');
  });

  test('does not treat a single moved child file as a folder move while the old parent still exists', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addDirectory('/workspace/src/watch');
    fs.addDirectory('/workspace/src/vscode/watch');
    fs.addFile('/workspace/src/vscode/watch/watcher.ts', 'source watcher');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch/watcher.ts'),
      uri('/workspace/src/vscode/watch/watcher.ts'),
    );

    assert.strictEqual(changed, false);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].sourcePath, 'src/watch');
  });

  test('does not auto-rebind sourcePath when source folder moves without rename evidence', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addDirectory('/workspace/src/vscode/watch');
    fs.addFile('/workspace/src/vscode/watch/index.ts', 'source index');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].sourcePath, 'src/watch');

    const orphaned = await project.listOrphanedCognition();
    assert.strictEqual(orphaned.length, 1);
    assert.strictEqual(orphaned[0].registryKey, 'watch/');
  });

  test('does not auto-rebind sourcePath when basename match exists without rename evidence', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addDirectory('/workspace/src/vscode/watch');
    fs.addDirectory('/workspace/src/other/watch');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].sourcePath, 'src/watch');

    const orphaned = await project.listOrphanedCognition();
    assert.strictEqual(orphaned.length, 1);
  });

  test('updates one registry sourcePath record when a source file is renamed', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/watch/readme.ts', 'source');
    fs.addFile('/workspace/src/vscode/watch/readme.ts', 'source');
    fs.addFile('/workspace/cognition/watch/readme.ts.md', 'cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/readme.ts': makeEntry({
        sourcePath: 'src/watch/readme.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch/readme.ts'),
      uri('/workspace/src/vscode/watch/readme.ts'),
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/readme.ts'].sourcePath, 'src/vscode/watch/readme.ts');
  });

  test('reloads and reconciles a source rename after a registry revision mismatch', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/watch/readme.ts', 'source');
    fs.addFile('/workspace/cognition/watch/readme.ts.md', 'cognition');
    fs.addFile('/workspace/src/other.ts', 'other source');
    fs.addFile('/workspace/cognition/other.ts.md', 'other cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/readme.ts': makeEntry({
        sourcePath: 'src/watch/readme.ts',
      }),
      'other.ts': makeEntry({
        sourcePath: 'src/other.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    fs.remove('/workspace/src/watch/readme.ts');
    fs.addFile('/workspace/src/vscode/watch/readme.ts', 'source');
    provider.mutateOnNextLoad((file) => ({
      ...file,
      entries: {
        ...file.entries,
        'other.ts': {
          ...file.entries['other.ts'],
          type: 'folder' as const,
        },
      },
    }));

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch/readme.ts'),
      uri('/workspace/src/vscode/watch/readme.ts'),
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/readme.ts'].sourcePath, 'src/vscode/watch/readme.ts');
    assert.strictEqual(saved?.entries['other.ts'].type, 'folder');
  });

  test('does not update registry sourcePath when rename leaves source root', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/archive/watch/index.ts', 'source index');
    fs.addFile('/workspace/cognition/watch/index.ts.md', 'cognition index');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/index.ts': makeEntry({
        sourcePath: 'src/watch/index.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    const saveCountAfterOpen = provider.saveCount;

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch/index.ts'),
      uri('/workspace/archive/watch/index.ts'),
    );

    assert.strictEqual(changed, false);
    assert.strictEqual(provider.saveCount, saveCountAfterOpen);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/index.ts'].sourcePath, 'src/watch/index.ts');
  });

  test('returns false for source rename when registry is unavailable', async () => {
    const fs = new MockFileSystem();
    const services = createCoggitServices(fs, new MockConfigProvider());
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.applySourceRename(
      uri('/workspace/src/watch'),
      uri('/workspace/src/vscode/watch'),
    );

    assert.strictEqual(changed, false);
  });

  test('reconciles a completed cognition move after a registry revision mismatch', async () => {
    const fs = new MockFileSystem();
    const cognition = '# cognition\n\n' + 'Detailed maintained behavior. '.repeat(8);
    fs.addFile('/workspace/src/new/foo.ts', 'source');
    fs.addFile('/workspace/cognition/old/foo.ts.md', cognition);
    fs.addFile('/workspace/src/other.ts', 'other source');
    fs.addFile('/workspace/cognition/other.ts.md', 'other cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'old/foo.ts': makeEntry({
        sourcePath: 'src/new/foo.ts',
      }),
      'other.ts': makeEntry({
        sourcePath: 'src/other.ts',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    const [misplaced] = await project.listMisplacedCognition();
    assert.ok(misplaced);
    provider.mutateOnNextLoad((file) => ({
      ...file,
      entries: {
        ...file.entries,
        'other.ts': {
          ...file.entries['other.ts'],
          type: 'folder' as const,
        },
      },
    }));

    const error = await project.moveCognitionToExpected(misplaced);

    assert.strictEqual(error, undefined);
    assert.strictEqual(await fs.exists(uri('/workspace/cognition/old/foo.ts.md')), false);
    assert.strictEqual(await fs.exists(uri('/workspace/cognition/new/foo.ts.md')), true);
    assert.deepStrictEqual(await project.listMisplacedCognition(), []);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['new/foo.ts'].sourcePath, 'src/new/foo.ts');
    assert.strictEqual(saved?.entries['other.ts'].type, 'folder');
  });

  test('does not persist a directory observation before acceptance', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/watch/foo.ts', 'source foo');
    fs.addFile('/workspace/src/watch/bar.ts', 'source bar');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
        sourceFactMtimeMs: 1000,
        sourceFactHash: computeBlobHash('foo.ts'),
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.recordDirectoryEntryChange(
      uri('/workspace/src/watch/bar.ts'),
      9000,
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['watch/'].accepted, null);
  });

  test('does not persist a source-root observation before acceptance', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/index.ts', 'source index');
    fs.addFile('/workspace/cognition/README.md', 'root cognition');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      '/': makeEntry({
        sourcePath: 'src',
        type: 'folder',
        sourceFactMtimeMs: null,
        sourceFactHash: null,
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());

    const changed = await project.recordDirectoryEntryChange(
      uri('/workspace/src/index.ts'),
      7000,
    );

    assert.strictEqual(changed, true);
    const saved = await provider.load();
    assert.strictEqual(saved?.entries['/'].accepted, null);
  });

  test('records directory observations without building a project snapshot', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/watch/foo.ts', 'source foo');
    fs.addFile('/workspace/src/watch/bar.ts', 'source bar');
    fs.addFile('/workspace/src/watch/nested/index.ts', 'nested source');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    fs.readFileCount = 0;
    fs.readDirectoryCalls = [];

    const changed = await project.recordDirectoryEntryChange(
      uri('/workspace/src/watch/bar.ts'),
      9000,
    );

    assert.strictEqual(changed, true);
    assert.strictEqual(fs.readFileCount, 0);
    assert.deepStrictEqual(fs.readDirectoryCalls, ['/workspace/src/watch']);
  });

  test('does not persist directory entry source fact when fingerprint is unchanged', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/src/watch/foo.ts', 'source foo');
    fs.addFile('/workspace/cognition/watch/README.md', 'cognition readme');

    const provider = new CountingRegistryProvider(makeRegistryFile({
      'watch/': makeEntry({
        sourcePath: 'src/watch',
        type: 'folder',
        sourceFactMtimeMs: 5000,
        sourceFactHash: computeBlobHash('foo.ts'),
      }),
    }));
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, makeRoot());
    const saveCountAfterOpen = provider.saveCount;

    const changed = await project.recordDirectoryEntryChange(
      uri('/workspace/src/watch/foo.ts'),
      9000,
    );

    assert.strictEqual(changed, true);
    assert.strictEqual(provider.saveCount, saveCountAfterOpen);
  });
});
