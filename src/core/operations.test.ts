import * as assert from 'node:assert';
import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  RegistryProviderFactory,
  UriComponents,
} from './interfaces';
import type { CoggitWorkspaceRoot, RegistryFile } from './types';
import { computeBlobHash } from './hash';
import { openCoggitProject } from './project';
import {
  addOperation,
  handbookCatalog,
  resolveOperation,
  snapshotOperation,
  statusOperation,
} from './operations';

interface MockFileEntry {
  isDirectory: boolean;
  content: string;
  mtimeMs: number;
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, MockFileEntry>();
  private readonly readCounts = new Map<string, number>();
  private afterReadHook: ((path: string, count: number) => void) | undefined;

  setAfterReadHook(hook: ((path: string, count: number) => void) | undefined): void {
    this.afterReadHook = hook;
  }

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
    const content = entry.content;
    const count = (this.readCounts.get(uri.path) ?? 0) + 1;
    this.readCounts.set(uri.path, count);
    this.afterReadHook?.(uri.path, count);
    return content;
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
    const dirPath = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
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
  private pendingLoadMutation: {
    remainingLoads: number;
    mutation: (file: RegistryFile) => RegistryFile;
  } | undefined;

  constructor(private data: RegistryFile | null) {}

  async load(): Promise<RegistryFile | null> {
    if (this.data && this.pendingLoadMutation) {
      if (this.pendingLoadMutation.remainingLoads === 0) {
        this.data = this.pendingLoadMutation.mutation(JSON.parse(JSON.stringify(this.data)));
        this.pendingLoadMutation = undefined;
      } else {
        this.pendingLoadMutation.remainingLoads--;
      }
    }
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  async save(file: RegistryFile): Promise<void> {
    this.saveCount++;
    this.data = JSON.parse(JSON.stringify(file));
  }

  current(): RegistryFile | null {
    return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
  }

  mutateOnNextLoad(mutation: (file: RegistryFile) => RegistryFile): void {
    this.mutateAfterLoads(0, mutation);
  }

  mutateAfterLoads(
    remainingLoads: number,
    mutation: (file: RegistryFile) => RegistryFile,
  ): void {
    this.pendingLoadMutation = { remainingLoads, mutation };
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

async function makeProject(fs: MockFileSystem, registry?: CountingRegistryProvider) {
  const registryFactory: RegistryProviderFactory | undefined = registry
    ? { create: () => registry }
    : undefined;
  return openCoggitProject({ fs, config: new MockConfigProvider(), registry: registryFactory }, makeRoot());
}

function registryFile(entries: RegistryFile['entries']): RegistryFile {
  return {
    schemaVersion: 2,
    updatedAt: '2026-07-21T00:00:00.000Z',
    entries,
  };
}

suite('core operations', () => {
  test('snapshot defaults to tracked scope and exposes compact counts', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = true;');
    fs.addFile('/workspace/cognition/tracked.ts.md', '# tracked');
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project]);

    assert.strictEqual(result.scope, 'tracked');
    assert.strictEqual(result.projectCount, 1);
    assert.strictEqual(result.maxDepth, null);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.omittedChildrenCount, 0);
    assert.strictEqual(result.trackedCount, 1);
    assert.strictEqual(result.untrackedCount, 2);
    assert.ok(result.issueCount >= 1);
    assert.ok(result.nextScopes.includes('untracked'));
    assert.ok(result.suggestedActions.some((action) => action.operation === 'snapshot' && action.scope === 'untracked'));
    assert.ok(result.suggestedActions.some((action) => action.operation === 'snapshot' && action.scope === 'issues'));
    assert.ok(result.suggestedActions.some((action) => action.operation === 'status' && action.sourcePath === '.'));
  });

  test('snapshot reports effective max depth and omitted children', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/feature/nested/deep.ts', 'export const deep = true;');
    fs.addFile('/workspace/cognition/feature/nested/deep.ts.md', '# deep');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project], { maxDepth: 1 });

    assert.strictEqual(result.maxDepth, 1);
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.omittedChildrenCount, 1);
    assert.ok(result.suggestedActions.some((action) => action.operation === 'snapshot' && action.maxDepth === 1));
  });

  test('source-scoped snapshot suggests status diagnosis for the matched source path', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/feature/nested/deep.ts', 'export const deep = true;');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project], { sourcePath: 'feature', maxDepth: 0 });

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.sourcePath, 'feature');
    assert.strictEqual(result.maxDepth, 0);
    assert.strictEqual(result.truncated, true);
    assert.ok(result.suggestedActions.some((action) => (
      action.operation === 'status'
      && action.sourcePath === 'feature'
    )));
  });

  test('status default projection excludes the untracked issue but keeps the add next step', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'missing.ts');

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.sourcePath, 'missing.ts');
    assert.strictEqual(result.project?.sourceRootUri, 'test:///workspace/src');
    assert.strictEqual(result.handbookId, 'leaf');
    assert.strictEqual(result.issueCount, 0);
    assert.strictEqual(result.ownIssueCount, 0);
    assert.strictEqual(result.descendantIssueCount, 0);
    assert.deepStrictEqual(result.issues, []);
    // The missing-cognition issue is dropped by the default `maintained` filter,
    // but the add next step is synthesized from the first-class node signal
    // (`cognitionPresence === 'missing'`), so it survives the filter.
    assert.deepStrictEqual(result.suggestedActions, [{
      code: 'create-cognition',
      label: 'Create cognition file',
      operation: 'add',
      sourcePath: 'missing.ts',
    }]);
  });

  test('status all-issue projection includes missing cognition diagnostics for internal diagnosis', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'missing.ts', { issueVisibility: 'all' });

    assert.strictEqual(result.issueCount, 1);
    assert.strictEqual(result.ownIssueCount, 1);
    assert.deepStrictEqual(result.issues.map((issue) => issue.code), ['missing-cognition']);
    // The operation-bearing add action is synthesized from the node signal and
    // wins over the label-only `missing-cognition` action (same source path and
    // label), so only the operation-bearing form survives.
    assert.deepStrictEqual(result.suggestedActions, [{
      code: 'create-cognition',
      label: 'Create cognition file',
      operation: 'add',
      sourcePath: 'missing.ts',
    }]);
  });

  test('status all-issue projection dedups descendant missing-cognition label against triage add', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    fs.addFile(
      '/workspace/cognition/README.md',
      [
        '# root',
        '',
        'This cognition describes the root source folder and its maintained structure.',
        'It is intentionally substantive so the root fixture has no own template issue.',
        'The test isolates descendant status filtering from root-level cognition health.',
      ].join('\n'),
      3000,
    );
    const project = await makeProject(fs);

    const result = await statusOperation([project], '.', { issueVisibility: 'all' });

    assert.strictEqual(result.found, true);
    // The descendant's structured `add` lives in its triage entry; the matching
    // label-only `missing-cognition` action is deduped out of `suggestedActions`
    // so the same remediation is not surfaced twice.
    assert.ok(!result.suggestedActions.some((action) => action.operation === 'add'));
    assert.deepStrictEqual(result.suggestedActions, []);
  });

  test('status synthesizes a resolve next step for own maintained stale cognition', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/stale.ts', 'export const stale = 1;', 2000);
    fs.addFile(
      '/workspace/cognition/stale.ts.md',
      '# stale\n\nThis cognition describes earlier source behavior in enough detail.',
      1000,
    );
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'stale.ts');

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.status, 'stale');
    // The stale next steps are the ordered pair-maintenance pair: the
    // handbook-bearing sync authoring step leads, the resolve accept step
    // trails. Core does not invent an edit/sync operation — the sync step is
    // a handbookId reference — and the issue's label-only edit action (same
    // source path and label) is deduped so exactly one sync hint remains.
    // The template hint is distinct edit work (different label) and survives.
    assert.deepStrictEqual(result.suggestedActions, [{
      code: 'sync-cognition-with-source',
      label: 'Sync cognition with source changes',
      handbookId: 'leaf',
      sourcePath: 'stale.ts',
    }, {
      code: 'resolve-stale-cognition',
      label: 'After syncing, accept the pair as reviewed',
      operation: 'resolve',
      sourcePath: 'stale.ts',
    }, {
      code: 'fill-in-cognition-content',
      label: 'Fill in cognition content',
      sourcePath: 'stale.ts',
    }]);
  });

  test('status does not synthesize a resolve next step for descendant-only stale', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/stale.ts', 'export const stale = 1;', 2000);
    fs.addFile(
      '/workspace/cognition/stale.ts.md',
      '# stale\n\nThis cognition describes earlier source behavior in enough detail.',
      1000,
    );
    fs.addFile(
      '/workspace/cognition/README.md',
      [
        '# root',
        '',
        'This cognition describes the root source folder and its maintained structure.',
        'It is intentionally substantive so the root fixture has no own template issue.',
        'The test isolates descendant status filtering from root-level cognition health.',
      ].join('\n'),
      3000,
    );
    const project = await makeProject(fs);

    const result = await statusOperation([project], '.');

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.descendantStatus, 'stale');
    // Descendant next steps stay in the triage channel: no resolve/add is
    // synthesized into the top-level channel, and the descendant's label-only
    // sync edit label is deduped against its structured triage sync-leaf action
    // (regression guard for the redundant `hint=sync-*` presentation bug).
    assert.deepStrictEqual(result.suggestedActions, []);
  });

  test('status default projection excludes untracked descendants', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/stale.ts', 'export const stale = 1;', 2000);
    fs.addFile(
      '/workspace/cognition/stale.ts.md',
      '# stale\n\nThis cognition describes earlier source behavior in enough detail.',
      1000,
    );
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    fs.addFile(
      '/workspace/cognition/README.md',
      [
        '# root',
        '',
        'This cognition describes the root source folder and its maintained structure.',
        'It is intentionally substantive so the root fixture has no own template issue.',
        'The test isolates descendant status filtering from root-level cognition health.',
      ].join('\n'),
      3000,
    );
    const project = await makeProject(fs);

    const result = await statusOperation([project], '.');

    assert.strictEqual(result.found, true);
    assert.deepStrictEqual(result.issues.map((issue) => issue.relativePath), ['stale.ts']);
    assert.ok(result.issues.every((issue) => issue.code !== 'missing-cognition'));
    assert.strictEqual(result.issueCount, 1);
    assert.strictEqual(result.descendantIssueCount, 1);
    assert.ok(!result.suggestedActions.some((action) => action.label === 'Create cognition file'));
  });

  test('add returns typed expected failure for invalid kind', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/file.ts', 'export const value = 1;');
    const project = await makeProject(fs);

    const result = await addOperation([project], 'file.ts', { kind: 'skeleton' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'invalid-kind');
    assert.deepStrictEqual(result.suggestedActions, [{
      code: 'recheck-status',
      label: 'Re-check the current status of this source path.',
      operation: 'status',
      sourcePath: 'file.ts',
    }]);
  });

  test('add returns source-root and cognition-root relative paths', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const missing = true;');
    const project = await makeProject(fs);

    const result = await addOperation([project], 'src/missing.ts');

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sourcePath, 'missing.ts');
    assert.strictEqual(result.cognitionPath, 'missing.ts.md');
    assert.deepStrictEqual(result.suggestedActions, []);
  });

  test('add resolves a candidate form through sourcePathCandidates', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/coggit/src/core/watchPipeline.ts', 'export const w = 1;');
    const project = await makeProject(fs);

    const result = await addOperation([project], 'src/core/watchPipeline.ts', {
      sourcePathCandidates: () => ['coggit/src/core/watchPipeline.ts'],
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sourcePath, 'coggit/src/core/watchPipeline.ts');
    assert.strictEqual(result.cognitionPath, 'coggit/src/core/watchPipeline.ts.md');
  });

  test('add path-not-found carries fuzzy hints and miss fields', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/coggit/src/core/watchPipeline.ts', 'export const w = 1;');
    const project = await makeProject(fs);

    const result = await addOperation([project], 'src/core/watchPipeline.ts');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error?.code, 'path-not-found');
    assert.ok(result.pathHints.includes('coggit/src/core/watchPipeline.ts'));
    assert.strictEqual(result.pathMissMessage, 'Path not found in any CogGit project: src/core/watchPipeline.ts');
    assert.ok(result.pathHintMessage);
  });

  test('handbook catalog exposes stable ids and node-kind routing', () => {
    const catalog = handbookCatalog();

    assert.deepStrictEqual(
      catalog.map((entry) => entry.id),
      ['all', 'leaf', 'skeleton'],
    );
    assert.strictEqual(catalog.find((entry) => entry.id === 'leaf')?.nodeKind, 'file');
    assert.strictEqual(catalog.find((entry) => entry.id === 'skeleton')?.nodeKind, 'folder');
  });

  test('status normalizes backslashes in sourcePath', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/feature/nested/deep.ts', 'export const x = 1;');
    fs.addFile('/workspace/cognition/feature/nested/deep.ts.md', '# deep');
    const project = await makeProject(fs);

    const backslashResult = await statusOperation([project], 'feature\\nested\\deep.ts');
    assert.strictEqual(backslashResult.found, true);
    assert.strictEqual(backslashResult.sourcePath, 'feature/nested/deep.ts');

    const forwardResult = await statusOperation([project], 'feature/nested/deep.ts');
    assert.strictEqual(forwardResult.found, true);
    assert.strictEqual(forwardResult.sourcePath, 'feature/nested/deep.ts');
  });

  test('snapshot normalizes backslashes in sourcePath', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/feature/nested/deep.ts', 'export const x = 1;');
    fs.addFile('/workspace/cognition/feature/nested/deep.ts.md', '# deep');
    const project = await makeProject(fs);

    const backslashResult = await snapshotOperation([project], { sourcePath: 'feature\\nested\\deep.ts' });
    assert.strictEqual(backslashResult.found, true);
    assert.strictEqual(backslashResult.sourcePath, 'feature\\nested\\deep.ts');

    const forwardResult = await snapshotOperation([project], { sourcePath: 'feature/nested/deep.ts' });
    assert.strictEqual(forwardResult.found, true);
    assert.strictEqual(forwardResult.sourcePath, 'feature/nested/deep.ts');
  });

  test('status strips source-root prefix from project-relative paths', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const x = 1;');
    const project = await makeProject(fs);

    // sourceRoot is "src", project-relative "src/missing.ts" should be resolved
    const result = await statusOperation([project], 'src/missing.ts');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.sourcePath, 'missing.ts');
  });

  test('review unchanged advances verification time and resolves mtime-only stale', async () => {
    const fs = new MockFileSystem();
    const registry = new CountingRegistryProvider(registryFile({
      tracked: {
        sourcePath: 'src/tracked.ts',
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: null,
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));
    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = true;', 3000);
    fs.addFile('/workspace/cognition/tracked.ts.md',
      '# tracked\n\nThis cognition still represents the current tracked source.\n\nIt does not need a text edit for this review.',
      1000);
    const project = await makeProject(fs, registry);

    const review = await resolveOperation([project], 'tracked.ts');
    assert.strictEqual(review.success, true);
    assert.strictEqual(review.sourceKey, 'tracked.ts');
    assert.ok(review.verificationTimeMs !== null);

    const entry = registry.current()?.entries['tracked.ts'];
    assert.ok(entry?.accepted);

    const after = await statusOperation([project], 'tracked.ts');
    assert.strictEqual(after.status, 'fresh');

    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = false;', 4000);
    const changed = await statusOperation([project], 'tracked.ts');
    assert.strictEqual(changed.status, 'stale');
  });

  test('review unchanged refuses an acceptance when content changes during the operation', async () => {
    const fs = new MockFileSystem();
    const registry = new CountingRegistryProvider(registryFile({
      tracked: {
        sourcePath: 'src/tracked.ts',
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: null,
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));
    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = true;');
    fs.addFile('/workspace/cognition/tracked.ts.md',
      '# tracked\n\nThis cognition describes the current tracked source in enough detail for review.\n\nIt records the maintained behavior and verification boundary.');
    const project = await makeProject(fs, registry);

    fs.setAfterReadHook((path, count) => {
      if (path === '/workspace/src/tracked.ts' && count === 2) {
        fs.addFile('/workspace/src/tracked.ts', 'export const tracked = changed_during_review;');
      }
    });

    const review = await resolveOperation([project], 'tracked.ts');
    assert.strictEqual(review.success, false);
    assert.strictEqual(review.error?.code, 'content-changed');
    assert.strictEqual(registry.current()?.entries['tracked.ts']?.accepted, null);
  });

  test('resolve echoes the canonical node path on a post-resolution content-changed failure', async () => {
    const fs = new MockFileSystem();
    const registry = new CountingRegistryProvider(registryFile({
      tracked: {
        sourcePath: 'src/tracked.ts',
        type: 'leaf',
        sourceFactMtimeMs: null,
        cognitionMtimeMs: null,
        verificationTimeMs: null,
        createdAt: null,
        sourceFactHash: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));
    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = true;');
    fs.addFile('/workspace/cognition/tracked.ts.md',
      '# tracked\n\nThis cognition describes the current tracked source in enough detail for review.\n\nIt records the maintained behavior and verification boundary.');
    const project = await makeProject(fs, registry);

    fs.setAfterReadHook((path, count) => {
      if (path === '/workspace/src/tracked.ts' && count === 2) {
        fs.addFile('/workspace/src/tracked.ts', 'export const tracked = changed_during_review;');
      }
    });

    // `src/tracked.ts` is a non-canonical (source-root-prefixed) form that still
    // resolves to the `tracked.ts` node. The failure must echo the canonical
    // node path, not the raw caller input.
    const review = await resolveOperation([project], 'src/tracked.ts');
    assert.strictEqual(review.success, false);
    assert.strictEqual(review.error?.code, 'content-changed');
    assert.strictEqual(review.sourcePath, 'tracked.ts');
    assert.deepStrictEqual(review.suggestedActions, [{
      code: 'recheck-status',
      label: 'Re-check the current status of this source path.',
      operation: 'status',
      sourcePath: 'tracked.ts',
    }]);
  });

  test('review unchanged discards its acceptance when the registry revision changes', async () => {
    const fs = new MockFileSystem();
    const registry = new CountingRegistryProvider(registryFile({
      'tracked.ts': {
        sourcePath: 'src/tracked.ts',
        type: 'leaf',
        accepted: null,
        createdAt: null,
        cognitionBlobHash: null,
        cognitionLength: null,
      },
    }));
    fs.addFile('/workspace/src/tracked.ts', 'export const tracked = true;');
    fs.addFile(
      '/workspace/cognition/tracked.ts.md',
      '# tracked\n\nThis cognition records the maintained behavior and verification boundary.',
    );
    const project = await makeProject(fs, registry);
    registry.mutateAfterLoads(1, (file) => ({
      ...file,
      entries: {
        ...file.entries,
        'tracked.ts': {
          ...file.entries['tracked.ts'],
          createdAt: '2026-07-26T07:08:09.000Z',
        },
      },
    }));

    const review = await resolveOperation([project], 'tracked.ts');

    assert.strictEqual(review.success, false);
    assert.strictEqual(review.error?.code, 'registry-changed');
    assert.strictEqual(registry.current()?.entries['tracked.ts']?.accepted, null);
    assert.strictEqual(
      registry.current()?.entries['tracked.ts']?.createdAt,
      '2026-07-26T07:08:09.000Z',
    );
    const status = await statusOperation([project], 'tracked.ts');
    assert.strictEqual(status.status, 'stale');
  });

  test('snapshot strips source-root prefix from project-relative paths', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/missing.ts', 'export const x = 1;');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project], { sourcePath: 'src/missing.ts' });
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.sourcePath, 'src/missing.ts');
    // Matched path: miss diagnostics are omitted keys, never undefined values
    assert.ok(!('pathMissMessage' in result));
    assert.ok(!('pathHintMessage' in result));
  });

  test('snapshot miss without fuzzy hints omits hint diagnostics as keys', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/other/main.ts', 'export const o = 1;');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project], { sourcePath: 'src/never-exists.ts' });

    assert.strictEqual(result.found, false);
    assert.deepStrictEqual(result.pathHints, []);
    assert.strictEqual(result.pathMissMessage, 'Path not found in any CogGit project: src/never-exists.ts');
    assert.ok(!('pathHintMessage' in result));
  });

  test('status returns fuzzy path hints when the source path misses', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/coggit/src/core/watchPipeline.ts', 'export const w = 1;');
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'src/core/watchPipeline.ts');

    assert.strictEqual(result.found, false);
    assert.strictEqual(result.pathMissMessage, 'Path not found in any CogGit project: src/core/watchPipeline.ts');
    assert.ok(result.pathHints.includes('coggit/src/core/watchPipeline.ts'));
    assert.ok(result.pathHintMessage);
  });

  test('status returns no hints when the source path resolves', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/coggit/src/core/watchPipeline.ts', 'export const w = 1;');
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'coggit/src/core/watchPipeline.ts');

    assert.strictEqual(result.found, true);
    assert.deepStrictEqual(result.pathHints, []);
    assert.ok(!('pathMissMessage' in result));
    assert.ok(!('pathHintMessage' in result));
  });

  test('status miss without fuzzy hints omits the hint lead-in', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/other/main.ts', 'export const o = 1;');
    const project = await makeProject(fs);

    const result = await statusOperation([project], 'src/core/watchPipeline.ts');

    assert.strictEqual(result.found, false);
    assert.deepStrictEqual(result.pathHints, []);
    assert.strictEqual(result.pathMissMessage, 'Path not found in any CogGit project: src/core/watchPipeline.ts');
    assert.ok(!('pathHintMessage' in result));
  });

  test('snapshot returns fuzzy path hints when the source path misses', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/coggit/src/core/watchPipeline.ts', 'export const w = 1;');
    const project = await makeProject(fs);

    const result = await snapshotOperation([project], { sourcePath: 'src/core/watchPipeline.ts' });

    assert.strictEqual(result.found, false);
    assert.strictEqual(result.pathMissMessage, 'Path not found in any CogGit project: src/core/watchPipeline.ts');
    assert.ok(result.pathHints.includes('coggit/src/core/watchPipeline.ts'));
    assert.ok(result.pathHintMessage);
  });

  test('status triage exposes the descendant ordered pair without touching the top-level channel', async () => {
    const fs = new MockFileSystem();
    fs.addFile('/workspace/src/stale.ts', 'export const stale = 1;', 2000);
    fs.addFile(
      '/workspace/cognition/stale.ts.md',
      '# stale\n\nThis cognition describes earlier source behavior in enough detail.',
      1000,
    );
    fs.addFile(
      '/workspace/cognition/README.md',
      [
        '# root',
        '',
        'This cognition describes the root source folder and its maintained structure.',
        'It is intentionally substantive so the root fixture has no own template issue.',
        'The test isolates descendant status filtering from root-level cognition health.',
      ].join('\n'),
      3000,
    );
    const project = await makeProject(fs);

    const result = await statusOperation([project], '.');

    assert.strictEqual(result.found, true);
    assert.ok(result.inspection);
    // The top-level channel stays the inspected node's direct next-step
    // surface: all descendant actions (structured and label-only) stay in the
    // triage channel.
    assert.deepStrictEqual(result.suggestedActions, []);
    // The triage channel carries the descendant-scoped ordered pair: the
    // handbook-bearing sync step leads, the resolve accept step trails, both
    // re-scoped to the descendant sourcePath. The entry action channel is
    // structured-only — label-only issue guidance stays in the entry's issues,
    // so exactly the pair appears here.
    const entries = result.inspection.triage;
    assert.strictEqual(entries.length, 1);
    const entry = entries[0];
    assert.strictEqual(entry.relation, 'descendant');
    assert.strictEqual(entry.sourcePath, 'stale.ts');
    assert.deepStrictEqual(entry.actions, [{
      code: 'sync-cognition-with-source',
      label: 'Sync cognition with source changes',
      handbookId: 'leaf',
      sourcePath: 'stale.ts',
    }, {
      code: 'resolve-stale-cognition',
      label: 'After syncing, accept the pair as reviewed',
      operation: 'resolve',
      sourcePath: 'stale.ts',
    }]);
  });
});
