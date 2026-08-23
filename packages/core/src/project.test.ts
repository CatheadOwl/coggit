import * as assert from 'node:assert';
import { createCoggitServices, openCoggitProject } from './project';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  RegistryProviderFactory,
  UriComponents,
} from './interfaces';
import type { CoggitWorkspaceRoot, RegistryFile } from './types';

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, { isDirectory: boolean; content: string; mtimeMs: number }>();

  addDirectory(path: string): void {
    this.entries.set(path, { isDirectory: true, content: '', mtimeMs: 1000 });
  }

  async readFile(uri: UriComponents): Promise<string> {
    const entry = this.entries.get(uri.path);
    if (!entry || entry.isDirectory) {
      throw new Error('ENOENT');
    }
    return entry.content;
  }

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    this.entries.set(uri.path, { isDirectory: false, content, mtimeMs: 1000 });
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    const entry = this.entries.get(uri.path);
    return entry
      ? { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs }
      : undefined;
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const prefix = uri.path.endsWith('/') ? uri.path : uri.path + '/';
    const children: Array<[string, number]> = [];
    for (const [path, entry] of this.entries) {
      if (path === uri.path || !path.startsWith(prefix)) {
        continue;
      }
      const rest = path.slice(prefix.length);
      if (rest.length > 0 && !rest.includes('/')) {
        children.push([rest, entry.isDirectory ? 2 : 1]);
      }
    }
    return children;
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

class ThrowingRegistryProvider {
  async load(): Promise<RegistryFile | null> {
    throw new Error('registry unavailable');
  }

  async save(_file: RegistryFile): Promise<void> {
    throw new Error('registry unavailable');
  }
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

function createServicesWithThrowingRegistry() {
  const fs = new MockFileSystem();
  fs.addDirectory('/workspace');
  fs.addDirectory('/workspace/src');
  fs.addDirectory('/workspace/cognition');
  return createCoggitServices({
    fs,
    config: new MockConfigProvider(),
    registry: { create: () => new ThrowingRegistryProvider() } satisfies RegistryProviderFactory,
  });
}

suite('project registry initialization', () => {
  test('project open can degrade after initial registry reconciliation failure', async () => {
    const services = createServicesWithThrowingRegistry();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      const project = await openCoggitProject(services, makeRoot());

      assert.strictEqual(project.root.id, 'root');
      await assert.rejects(project.ensureFresh(), /registry unavailable/);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('project open can fail closed after initial registry reconciliation failure', async () => {
    const services = createServicesWithThrowingRegistry();

    await assert.rejects(
      openCoggitProject(services, makeRoot(), { registryInitFailure: 'throw' }),
      /registry unavailable/,
    );
  });
});
