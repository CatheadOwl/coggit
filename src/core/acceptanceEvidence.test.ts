import * as assert from 'node:assert';
import type { ConfigProvider, FileStat, FileSystem, RegistryProviderFactory, UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot, PathKeyRecord, RegistryFile } from './types';
import { computeCognitionIdentity, computeSourceFactIdentity } from './hash';
import { RuntimeAcceptanceEvidence, buildSnapshotFromProjects, createCoggitServices, openCoggitProject } from './project';
import { statusOperation } from './operations';
import { REGISTRY_SCHEMA_VERSION } from './registry/index';
import { applyWatchEventToProjects, planWatchRefresh } from './watchPipeline';

interface Entry {
  isDirectory: boolean;
  content: string;
}

class MockFileSystem implements FileSystem {
  private readonly entries = new Map<string, Entry>();
  readDirectoryCalls: string[] = [];

  addDirectory(path: string): void {
    this.entries.set(path, { isDirectory: true, content: '' });
  }

  addFile(path: string, content: string): void {
    this.entries.set(path, { isDirectory: false, content });
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const parent = '/' + parts.slice(0, i).join('/');
      if (!this.entries.has(parent)) {
        this.addDirectory(parent);
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
    return entry ? { isDirectory: entry.isDirectory, mtimeMs: 1 } : undefined;
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    this.readDirectoryCalls.push(uri.path);
    const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    return Array.from(this.entries.entries())
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, entry]) => [path.slice(prefix.length), entry.isDirectory ? 2 : 1]);
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

class MemoryRegistryProvider {
  constructor(private data: RegistryFile) {}

  async load(): Promise<RegistryFile> {
    return JSON.parse(JSON.stringify(this.data)) as RegistryFile;
  }

  async save(file: RegistryFile): Promise<void> {
    this.data = JSON.parse(JSON.stringify(file)) as RegistryFile;
  }

  current(): RegistryFile {
    return JSON.parse(JSON.stringify(this.data)) as RegistryFile;
  }
}

class MockConfigProvider implements ConfigProvider {
  getWorkspaceFolders() {
    return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
  }

  async findFiles(): Promise<UriComponents[]> {
    return [];
  }
}

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

function root(): CoggitWorkspaceRoot {
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

function entry(source: string, cognition: string): PathKeyRecord {
  return {
    sourcePath: 'src/tracked.ts',
    type: 'leaf',
    accepted: {
      source: computeSourceFactIdentity('file-content', source),
      cognition: computeCognitionIdentity(cognition),
    },
  };
}

async function makeCase() {
  const source = 'const source = "A";';
  const cognition = '# tracked\n\nThis cognition records the accepted relationship for the current source and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.';
  const fs = new MockFileSystem();
  fs.addFile('/workspace/src/tracked.ts', source);
  fs.addFile('/workspace/cognition/tracked.ts.md', cognition);
  const provider = new MemoryRegistryProvider({
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    updatedAt: '2026-07-26T00:00:00.000Z',
    entries: { 'tracked.ts': entry(source, cognition) },
  });
  const services = createCoggitServices(
    fs,
    new MockConfigProvider(),
    { create: () => provider } satisfies RegistryProviderFactory,
  );
  return { fs, provider, services };
}

suite('runtime acceptance evidence', () => {
  test('accepts both changed identities only when source was observed first', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());

    fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    await project.recordSourceChange(uri('/workspace/src/tracked.ts'), 1);
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    assert.strictEqual(await project.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 2), true);

    const accepted = provider.current().entries['tracked.ts'].accepted;
    assert.strictEqual(accepted?.source, computeSourceFactIdentity('file-content', 'const source = "a";'));
    assert.strictEqual(
      accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
  });

  test('accepts cognition-only changes during the cognition watcher observation', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition records the accepted relationship after a cognition-only maintenance edit.\n\nIt keeps the same source fact but updates the maintained explanation in detail.\n\nThe document remains the maintained reference for this source.');

    assert.strictEqual(await project.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 1), true);
    const accepted = provider.current().entries['tracked.ts'].accepted;
    assert.strictEqual(accepted?.source, computeSourceFactIdentity('file-content', 'const source = "A";'));
    assert.strictEqual(
      accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
  });

  test('keeps no-watcher cognition-only convergence through status reads', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition records the accepted relationship after a no-watcher maintenance edit.\n\nIt keeps the same source fact but updates the maintained explanation in detail.\n\nThe document remains the maintained reference for this source.');

    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
    assert.strictEqual(
      provider.current().entries['tracked.ts'].accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
  });

  test('keeps both changed identities stale when order is reversed or unknown', async () => {
    const reversed = await makeCase();
    const reversedProject = await openCoggitProject(reversed.services, root());
    reversed.fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    assert.strictEqual(await reversedProject.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 1), true);
    reversed.fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    await reversedProject.recordSourceChange(uri('/workspace/src/tracked.ts'), 2);
    assert.strictEqual((await statusOperation([reversedProject], 'tracked.ts')).status, 'stale');
    const reversedAccepted = reversed.provider.current().entries['tracked.ts'].accepted;
    assert.strictEqual(reversedAccepted?.source, computeSourceFactIdentity('file-content', 'const source = "A";'));
    assert.strictEqual(
      reversedAccepted?.cognition,
      computeCognitionIdentity(await reversed.fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );

    const unknown = await makeCase();
    const unknownProject = await openCoggitProject(unknown.services, root());
    unknown.fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    unknown.fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    assert.strictEqual((await statusOperation([unknownProject], 'tracked.ts')).status, 'stale');
  });

  test('preserves ordering evidence when a host reopens a project with the same evidence store', async () => {
    const { fs, services, provider } = await makeCase();
    const runtimeEvidence = new RuntimeAcceptanceEvidence();
    const firstProject = await openCoggitProject(services, root(), {
      runtimeEvidence: () => runtimeEvidence,
    });
    fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    await firstProject.recordSourceChange(uri('/workspace/src/tracked.ts'), 1);

    const reopenedProject = await openCoggitProject(services, root(), {
      runtimeEvidence: () => runtimeEvidence,
    });
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    assert.strictEqual(await reopenedProject.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 2), true);

    const accepted = provider.current().entries['tracked.ts'].accepted;
    assert.strictEqual(accepted?.source, computeSourceFactIdentity('file-content', 'const source = "a";'));
    assert.strictEqual(
      accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
    assert.strictEqual((await statusOperation([reopenedProject], 'tracked.ts')).status, 'fresh');
  });

  test('discards ordering evidence when the host runtime evidence store is recreated', async () => {
    const { fs, services } = await makeCase();
    const firstProject = await openCoggitProject(services, root());
    fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    await firstProject.recordSourceChange(uri('/workspace/src/tracked.ts'), 1);

    const restartedProject = await openCoggitProject(services, root());
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    assert.strictEqual(await restartedProject.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 2), false);

    assert.strictEqual((await statusOperation([restartedProject], 'tracked.ts')).status, 'stale');
  });

  test('does not passively accept template cognition content', async () => {
    const source = 'const source = "A";';
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/tracked.ts', source);
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nTODO');
    const provider = new MemoryRegistryProvider({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: '2026-07-26T00:00:00.000Z',
      entries: {
        'tracked.ts': {
          sourcePath: 'src/tracked.ts',
          type: 'leaf',
          accepted: null,
        },
      },
    });
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, root());

    assert.strictEqual(await project.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 1), false);
    assert.strictEqual(provider.current().entries['tracked.ts'].accepted, null);
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'stale');
  });

  test('does not rescan the tree for leaf cognition acceptance', async () => {
    const { fs, services } = await makeCase();
    const project = await openCoggitProject(services, root());
    fs.readDirectoryCalls = [];

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition records the accepted relationship after a leaf-only maintenance edit.\n\nIt keeps the same source fact but updates the maintained explanation in detail.\n\nThe document remains the maintained reference for this source.');

    assert.strictEqual(await project.recordCognitionChange(uri('/workspace/cognition/tracked.ts.md'), 2), true);
    assert.deepStrictEqual(
      fs.readDirectoryCalls.filter((path) => path.startsWith('/workspace/src')),
      [],
    );
  });

  test('only reads the target folder for folder cognition acceptance', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/folder/item.ts', 'export const value = 1;');
    fs.addFile('/workspace/src/folder/.gitignore', '*.tmp');
    fs.addFile('/workspace/cognition/folder/README.md', '# folder\n\nThis folder cognition records the accepted relationship after a folder-only maintenance edit.\n\nIt keeps the same source fact but updates the maintained explanation in detail.\n\nThe document remains the maintained reference for this source.');
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nplaceholder');
    const provider = new MemoryRegistryProvider({
      schemaVersion: REGISTRY_SCHEMA_VERSION,
      updatedAt: '2026-07-26T00:00:00.000Z',
      entries: {
        'folder/': {
          sourcePath: 'src/folder',
          type: 'folder',
          accepted: null,
        },
      },
    });
    const services = createCoggitServices(
      fs,
      new MockConfigProvider(),
      { create: () => provider } satisfies RegistryProviderFactory,
    );
    const project = await openCoggitProject(services, {
      ...root(),
      sourceRootUri: uri('/workspace/src'),
      cognitionRootUri: uri('/workspace/cognition'),
    });
    fs.readDirectoryCalls = [];

    assert.strictEqual(await project.recordCognitionChange(uri('/workspace/cognition/folder/README.md'), 1), true);
    assert.deepStrictEqual(
      fs.readDirectoryCalls.filter((path) => path.startsWith('/workspace/src')),
      ['/workspace/src/folder'],
    );
  });
});

suite('watch pipeline direct diagnostics', () => {
  test('accepts source then cognition watcher events into durable registry state', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());
    const initialSnapshot = await buildSnapshotFromProjects([project]);

    const route = planWatchRefresh(initialSnapshot, [
      uri('/workspace/src/tracked.ts'),
    ]);
    assert.strictEqual(route.mode, 'partial');

    fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    const sourceResult = await applyWatchEventToProjects([project], {
      domain: 'source',
      uri: uri('/workspace/src/tracked.ts'),
      kind: 'change',
      generation: 1,
    });
    assert.strictEqual(sourceResult.projectCount, 1);
    // Source observations update runtime ordering evidence but do not write durable registry acceptance.
    assert.strictEqual(sourceResult.sourceObservationCount, 1);
    assert.strictEqual(sourceResult.directoryObservationCount, 0);

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    const cognitionResult = await applyWatchEventToProjects([project], {
      domain: 'cognition',
      uri: uri('/workspace/cognition/tracked.ts.md'),
      kind: 'change',
      generation: 2,
    });

    assert.strictEqual(cognitionResult.passiveAcceptanceCount, 1);
    const accepted = provider.current().entries['tracked.ts'].accepted;
    assert.strictEqual(accepted?.source, computeSourceFactIdentity('file-content', 'const source = "a";'));
    assert.strictEqual(
      accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
  });

  test('accepts cognition-only watcher events through the pipeline', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition records the accepted relationship after a pipeline-delivered cognition-only maintenance edit.\n\nIt keeps the same source fact but updates the maintained explanation in detail.\n\nThe document remains the maintained reference for this source.');

    const result = await applyWatchEventToProjects([project], {
      domain: 'cognition',
      uri: uri('/workspace/cognition/tracked.ts.md'),
      kind: 'change',
      generation: 1,
    });

    assert.strictEqual(result.passiveAcceptanceCount, 1);
    assert.strictEqual(
      provider.current().entries['tracked.ts'].accepted?.cognition,
      computeCognitionIdentity(await fs.readFile(uri('/workspace/cognition/tracked.ts.md'))),
    );
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'fresh');
  });

  test('keeps reversed source and cognition watcher ordering stale', async () => {
    const { fs, services, provider } = await makeCase();
    const project = await openCoggitProject(services, root());

    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked\n\nThis cognition now records the revised source relationship and explains the maintained behavior in detail.\n\nIt also records the verification boundary for future maintenance.\n\nThe document remains the maintained reference for this source.');
    const cognitionResult = await applyWatchEventToProjects([project], {
      domain: 'cognition',
      uri: uri('/workspace/cognition/tracked.ts.md'),
      kind: 'change',
      generation: 1,
    });
    assert.strictEqual(cognitionResult.passiveAcceptanceCount, 1);

    fs.addFile('/workspace/src/tracked.ts', 'const source = "a";');
    await applyWatchEventToProjects([project], {
      domain: 'source',
      uri: uri('/workspace/src/tracked.ts'),
      kind: 'change',
      generation: 2,
    });

    const accepted = provider.current().entries['tracked.ts'].accepted;
    // Source events record observed facts but do not rewrite the accepted source fact on their own.
    assert.strictEqual(accepted?.source, computeSourceFactIdentity('file-content', 'const source = "A";'));
    assert.strictEqual((await statusOperation([project], 'tracked.ts')).status, 'stale');
  });

  test('routes outside-root watcher batches to none', async () => {
    const { services } = await makeCase();
    const project = await openCoggitProject(services, root());
    const snapshot = await buildSnapshotFromProjects([project]);

    const route = planWatchRefresh(snapshot, [
      uri('/elsewhere/src/tracked.ts'),
    ]);

    assert.strictEqual(route.mode, 'none');
    assert.strictEqual(route.reason, 'outside-known-roots');
  });
});
