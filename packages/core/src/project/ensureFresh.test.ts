import * as assert from 'node:assert';
import { createCoggitServices, openCoggitProject } from './project';
import type { ProjectLockContext, ProjectLockManager } from '../locks';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  RegistryProviderFactory,
  UriComponents,
} from '../interfaces';
import type { CoggitWorkspaceRoot, RegistryFile } from '../types';

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, { isDirectory: boolean; content: string; mtimeMs: number }>();

  addDirectory(path: string): void {
    this.entries.set(path, { isDirectory: true, content: '', mtimeMs: 1000 });
  }

  addFile(path: string, content: string, mtimeMs = 1000): void {
    this.entries.set(path, { isDirectory: false, content, mtimeMs });
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dirPath = '/' + parts.slice(0, i).join('/');
      if (!this.entries.has(dirPath)) {
        this.addDirectory(dirPath);
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

/**
 * Shared in-memory registry provider simulating a single registry.json on disk.
 * Multiple project instances sharing this provider simulate multiple processes
 * reading/writing the same file.
 */
class SharedRegistryProvider {
  private data: RegistryFile | null = null;
  saveCount = 0;

  async load(): Promise<RegistryFile | null> {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async save(file: RegistryFile): Promise<void> {
    this.saveCount++;
    this.data = JSON.parse(JSON.stringify(file));
  }
}

/**
 * A serializing lock manager that enforces mutual exclusion.
 * Only one callback runs at a time; others queue.
 * This simulates the NodeProjectLockManager file lock behavior.
 */
class SerializingLockManager implements ProjectLockManager {
  private queue: Array<() => void> = [];
  private locked = false;
  readonly acquisitions: ProjectLockContext[] = [];

  async withWriteLock<T>(
    _projectRoot: UriComponents,
    context: ProjectLockContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.acquire();
    this.acquisitions.push(context);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
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

function setupProject(fs: MockFileSystem): void {
  fs.addDirectory('/workspace');
  fs.addDirectory('/workspace/src');
  fs.addDirectory('/workspace/cognition');
  fs.addFile('/workspace/src/main.ts', 'console.log("hello");');
  fs.addFile(
    '/workspace/cognition/main.ts.md',
    '# main.ts\n\nEntry point for the application.\n\n## Contracts\n\n- Exports a main function.',
  );
}

suite('ensureFresh — concurrent reconciliation', () => {
  test('ensureFresh uses the project.ensure-fresh lock operation', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    const project = await openCoggitProject(services, makeRoot());
    assert.strictEqual(locks.acquisitions.length, 1);
    assert.strictEqual(locks.acquisitions[0].operation, 'project.open.reconcile');

    await project.ensureFresh();
    assert.strictEqual(locks.acquisitions.length, 2);
    assert.strictEqual(locks.acquisitions[1].operation, 'project.ensure-fresh');
  });

  test('concurrent ensureFresh calls are serialized by the lock', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    // Two project instances sharing the same registry provider and lock
    // simulates two MCP processes on the same project folder.
    const projectA = await openCoggitProject(services, makeRoot());
    const projectB = await openCoggitProject(services, makeRoot());

    // Add a new cognition file externally (simulates another process or manual edit)
    fs.addFile(
      '/workspace/cognition/utils.ts.md',
      '# utils.ts\n\nUtility functions.\n\n## Contracts\n\n- Pure functions only.',
    );
    fs.addFile('/workspace/src/utils.ts', 'export function add(a: number, b: number) { return a + b; }');

    // Fire both ensureFresh concurrently
    await Promise.all([projectA.ensureFresh(), projectB.ensureFresh()]);

    // Both should have acquired the lock (2 opens + 2 ensureFresh = 4 acquisitions)
    const freshCalls = locks.acquisitions.filter((c) => c.operation === 'project.ensure-fresh');
    assert.strictEqual(freshCalls.length, 2);

    // Registry should contain the new file (reconcile picked it up)
    const registryData = await provider.load();
    assert.ok(registryData, 'registry should exist');
    const keys = Object.keys(registryData.entries);
    assert.ok(
      keys.some((k) => k.includes('utils')),
      `registry should contain utils entry, got keys: ${keys.join(', ')}`,
    );
  });

  test('second concurrent ensureFresh does not overwrite first process result', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    const projectA = await openCoggitProject(services, makeRoot());
    const projectB = await openCoggitProject(services, makeRoot());

    // Record save count after open
    const savesAfterOpen = provider.saveCount;

    // Add a new file that both processes will discover
    fs.addFile(
      '/workspace/cognition/new-module.ts.md',
      '# new-module.ts\n\nA newly added module.\n\n## Contracts\n\n- Must be tested.',
    );
    fs.addFile('/workspace/src/new-module.ts', 'export const VERSION = "1.0.0";');

    // Concurrent ensureFresh
    await Promise.all([projectA.ensureFresh(), projectB.ensureFresh()]);

    // Both reconciles should have flushed (current implementation always flushes)
    assert.ok(provider.saveCount > savesAfterOpen, 'registry should have been flushed');

    // Final registry state should be consistent — contains the new entry
    const registryData = await provider.load();
    assert.ok(registryData);
    const keys = Object.keys(registryData.entries);
    assert.ok(
      keys.some((k) => k.includes('new-module')),
      `registry should contain new-module entry after concurrent refresh, got: ${keys.join(', ')}`,
    );

    // Both projects should be able to build a snapshot reflecting the new file
    const snapshotA = await projectA.buildSnapshot();
    const snapshotB = await projectB.buildSnapshot();
    const hasNewA = snapshotA.allNodes.some((n) => n.relativePath.includes('new-module'));
    const hasNewB = snapshotB.allNodes.some((n) => n.relativePath.includes('new-module'));
    assert.ok(hasNewA, 'project A snapshot should include new-module');
    assert.ok(hasNewB, 'project B snapshot should include new-module');
  });

  test('ensureFresh is idempotent when nothing changed', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    const project = await openCoggitProject(services, makeRoot());

    // Snapshot after open
    const snapshotBefore = await project.buildSnapshot();
    const nodeCountBefore = snapshotBefore.allNodes.length;

    // ensureFresh with no filesystem changes
    await project.ensureFresh();

    // Snapshot should be identical
    const snapshotAfter = await project.buildSnapshot();
    assert.strictEqual(
      snapshotAfter.allNodes.length,
      nodeCountBefore,
      'node count should not change when nothing changed on disk',
    );
  });

  test('ensureFresh detects externally added cognition file', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    const project = await openCoggitProject(services, makeRoot());

    // Verify initial state
    const before = await project.buildSnapshot();
    const beforeKeys = before.allNodes.map((n) => n.relativePath);
    assert.ok(!beforeKeys.some((k) => k.includes('late-addition')));

    // External process adds a cognition file
    fs.addFile(
      '/workspace/cognition/late-addition.ts.md',
      '# late-addition.ts\n\nAdded after project was opened.\n\n## Contracts\n\n- Late but valid.',
    );
    fs.addFile('/workspace/src/late-addition.ts', 'export default function late() {}');

    // ensureFresh should pick it up
    await project.ensureFresh();

    const after = await project.buildSnapshot();
    const afterKeys = after.allNodes.map((n) => n.relativePath);
    assert.ok(
      afterKeys.some((k) => k.includes('late-addition')),
      `snapshot should include late-addition after ensureFresh, got: ${afterKeys.join(', ')}`,
    );
  });

  test('maintenance diagnostics freshen the project runtime before listing', async () => {
    const fs = new MockFileSystem();
    setupProject(fs);
    const provider = new SharedRegistryProvider();
    const locks = new SerializingLockManager();
    const services = createCoggitServices({
      fs,
      config: new MockConfigProvider(),
      registry: { create: () => provider } satisfies RegistryProviderFactory,
      locks,
    });

    const project = await openCoggitProject(services, makeRoot());
    const freshCallsBefore = locks.acquisitions.filter((c) => c.operation === 'project.ensure-fresh').length;

    await project.listOrphanedCognition();
    await project.listMisplacedCognition();
    await project.listStrayCognition();

    const freshCallsAfter = locks.acquisitions.filter((c) => c.operation === 'project.ensure-fresh').length;
    assert.strictEqual(freshCallsAfter - freshCallsBefore, 3);
  });
});
