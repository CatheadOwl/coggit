import * as assert from 'node:assert';
import { createCoggitServices, openCoggitProject } from './project';
import {
  noOpProjectLockManager,
  noOpWatchLeaseManager,
  ProjectLockError,
  WatchLeaseError,
} from './locks';
import type { ProjectLockContext, ProjectLockManager } from './locks';
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

class MemoryRegistryProvider {
  private data: RegistryFile | null = null;

  async load(): Promise<RegistryFile | null> {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async save(file: RegistryFile): Promise<void> {
    this.data = JSON.parse(JSON.stringify(file));
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

suite('project write locks', () => {
  test('no-op lock manager returns callback result', async () => {
    const context: ProjectLockContext = {
      owner: 'cli',
      operation: 'test.write',
      projectLabel: 'test project',
    };

    const result = await noOpProjectLockManager.withWriteLock(
      uri('/workspace'),
      context,
      async () => 'written',
    );

    assert.strictEqual(result, 'written');
  });

  test('no-op lock manager propagates callback errors', async () => {
    const expected = new Error('write failed');

    await assert.rejects(
      noOpProjectLockManager.withWriteLock(
        uri('/workspace'),
        { owner: 'custom-host', operation: 'test.fail' },
        async () => {
          throw expected;
        },
      ),
      expected,
    );
  });

  test('lock errors carry stable code and context', () => {
    const context: ProjectLockContext = {
      owner: 'mcp',
      operation: 'test.contention',
    };
    const error = new ProjectLockError('locked', 'COGGIT_WRITE_LOCK_BUSY', context);

    assert.strictEqual(error.name, 'ProjectLockError');
    assert.strictEqual(error.code, 'COGGIT_WRITE_LOCK_BUSY');
    assert.strictEqual(error.context, context);
  });

  test('project open reconciliation runs through the configured write lock', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace');
    fs.addDirectory('/workspace/src');
    fs.addDirectory('/workspace/cognition');
    const provider = new MemoryRegistryProvider();
    const calls: ProjectLockContext[] = [];
    const locks: ProjectLockManager = {
      async withWriteLock(_projectRoot, context, fn) {
        calls.push(context);
        return fn();
      },
    };
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    await openCoggitProject(services, makeRoot());

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].owner, 'core');
    assert.strictEqual(calls[0].operation, 'project.open.reconcile');
    assert.strictEqual(calls[0].projectLabel, 'root');
  });
});

suite('watch lease', () => {
  test('no-op watch lease manager returns null', async () => {
    const context: ProjectLockContext = {
      owner: 'cli',
      operation: 'watch.try-acquire',
      projectLabel: 'test project',
    };

    const lease = await noOpWatchLeaseManager.tryAcquireWatchLease(
      uri('/workspace'),
      context,
    );

    assert.strictEqual(lease, null);
  });

  test('watch lease errors carry stable code and context', () => {
    const context: ProjectLockContext = {
      owner: 'cli',
      operation: 'watch.renew',
    };
    const error = new WatchLeaseError(
      'reclaimed',
      'COGGIT_WATCH_LEASE_RECLAIMED',
      context,
    );

    assert.strictEqual(error.name, 'WatchLeaseError');
    assert.strictEqual(error.code, 'COGGIT_WATCH_LEASE_RECLAIMED');
    assert.strictEqual(error.context, context);
    assert.ok(error instanceof ProjectLockError);
  });
});
