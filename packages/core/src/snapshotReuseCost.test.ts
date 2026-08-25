import * as assert from 'node:assert';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  UriComponents,
  WorkspaceFolderInfo,
} from './interfaces';
import type { CoggitWorkspaceRoot } from './types';
import { buildSnapshotFromProjects, openCoggitProject } from './project';
import { statusOperation } from './operations';

/**
 * Reusable per-path cost probe for `statusOperation` snapshot reuse.
 *
 * Measures `FileSystem.readFile` calls — the dominant cost signal, since each
 * read also triggers content hashing and the full evidence chain — across two
 * scenarios over an identical synthetic tree:
 *
 *   A. rebuild  — N `statusOperation(path)` calls, each rebuilding the tree.
 *   B. reuse    — 1 `buildSnapshotFromProjects` + N `statusOperation(path, { snapshot })`.
 *
 * Tune FILE_COUNT / QUERY_COUNT and re-run `pnpm run test:unit` to re-measure.
 * The printed table is the probe output; the assertions are the regression
 * guard: reuse must add zero reads beyond the single build, and rebuild must
 * scale linearly with the query count.
 */

// ─── Probe configuration ────────────────────────────────────────────────
const FILE_COUNT = 20; // tracked files in the synthetic tree
const QUERY_COUNT = 10; // source paths queried per scenario
// ─────────────────────────────────────────────────────────────────────────

class CountingFileSystem implements FileSystem {
  readCount = 0;
  private files = new Map<string, { content: string; mtimeMs: number }>();
  private dirs = new Set<string>();

  addFile(path: string, content: string, mtimeMs = 1000): void {
    this.files.set(path, { content, mtimeMs });
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      this.dirs.add('/' + parts.slice(0, i).join('/'));
    }
  }

  async readFile(uri: UriComponents): Promise<string> {
    const entry = this.files.get(uri.path);
    if (!entry) {
      throw new Error('ENOENT');
    }
    this.readCount++;
    return entry.content;
  }

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    this.files.set(uri.path, { content, mtimeMs: 1000 });
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    const entry = this.files.get(uri.path);
    if (entry) {
      return { isDirectory: false, mtimeMs: entry.mtimeMs };
    }
    if (this.dirs.has(uri.path)) {
      return { isDirectory: true, mtimeMs: 1000 };
    }
    return undefined;
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const dirPath = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    const children: Array<[string, number]> = [];
    const seen = new Set<string>();
    for (const path of [...this.files.keys(), ...this.dirs]) {
      if (path === uri.path || !path.startsWith(dirPath)) {
        continue;
      }
      const rest = path.slice(dirPath.length);
      if (rest.length > 0 && !rest.includes('/') && !seen.has(rest)) {
        seen.add(rest);
        children.push([rest, this.files.has(path) ? 1 : 2]);
      }
    }
    return children.sort(([left], [right]) => left.localeCompare(right));
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return this.files.has(uri.path) || this.dirs.has(uri.path);
  }

  async createDirectory(uri: UriComponents): Promise<void> {
    this.dirs.add(uri.path);
  }

  async delete(uri: UriComponents): Promise<void> {
    this.files.delete(uri.path);
    this.dirs.delete(uri.path);
  }
}

class StaticConfigProvider implements ConfigProvider {
  getWorkspaceFolders(): WorkspaceFolderInfo[] {
    return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
  }

  async findFiles(_pattern: string): Promise<UriComponents[]> {
    return [];
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

/** Seed `fileCount` tracked source+cognition pairs; returns the source-root-relative paths. */
function seedTree(fs: CountingFileSystem, fileCount: number): string[] {
  const paths: string[] = [];
  for (let i = 0; i < fileCount; i++) {
    fs.addFile(`/workspace/src/f${i}.ts`, `export const f${i} = ${i};`, 1000);
    fs.addFile(`/workspace/cognition/f${i}.ts.md`, `# f${i}\n\nCognition for f${i}.`, 1000);
    paths.push(`f${i}.ts`);
  }
  return paths;
}

suite('snapshot reuse cost probe', () => {
  test('reuse reads the tree once; rebuild reads it per query', async () => {
    const paths = Array.from({ length: FILE_COUNT }, (_, i) => `f${i}.ts`);

    // Scenario A — rebuild per path.
    const fsA = new CountingFileSystem();
    seedTree(fsA, FILE_COUNT);
    const projectA = await openCoggitProject(
      { fs: fsA, config: new StaticConfigProvider() },
      makeRoot(),
    );
    for (const path of paths.slice(0, QUERY_COUNT)) {
      await statusOperation([projectA], path);
    }
    const rebuildReads = fsA.readCount;

    // Scenario B — build once, then reuse.
    const fsB = new CountingFileSystem();
    seedTree(fsB, FILE_COUNT);
    const projectB = await openCoggitProject(
      { fs: fsB, config: new StaticConfigProvider() },
      makeRoot(),
    );
    const snapshot = await buildSnapshotFromProjects([projectB]);
    const buildReads = fsB.readCount;
    for (const path of paths.slice(0, QUERY_COUNT)) {
      await statusOperation([projectB], path, { snapshot });
    }
    const reuseReads = fsB.readCount;

    console.log(`\n[snapshot-reuse probe] fileCount=${FILE_COUNT} queryCount=${QUERY_COUNT}`);
    console.log(`  build   (1x tree) : ${buildReads} reads`);
    console.log(`  rebuild (${QUERY_COUNT} paths): ${rebuildReads} reads`);
    console.log(`  reuse   (${QUERY_COUNT} paths): ${reuseReads} reads`);

    assert.strictEqual(reuseReads, buildReads);
    assert.strictEqual(rebuildReads, QUERY_COUNT * buildReads);
  });
});
