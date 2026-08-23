/**
 * Real-disk E2E tests for folder/leaf stale detection.
 *
 * These tests create a real temporary directory structure, run the full
 * open → reconcile → buildSnapshot pipeline via NodeFileSystem, then mutate
 * the disk and verify that stale status changes correctly.
 *
 * They complement tree.test.ts (MockFS unit tests) by covering:
 *  - Real NTFS/ext4 mtime precision behaviour
 *  - reconcile → registry flush → tree build handoff on actual files
 *  - Directory mtime noise vs. genuine children-structure drift
 */
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { createNodeCoggitServices } from './public';
import { discoverCoggitProjects } from '@coggit/core';
import type { CoggitProject } from '@coggit/core';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FOLDER_README = [
  '# Foo',
  '',
  'This folder documents the foo module and its direct child structure.',
  '',
  'It is maintained cognition content that describes the module boundary.',
].join('\n');

const LEAF_COGNITION = [
  '# Bar',
  '',
  'This cognition describes the bar source file in detail with enough',
  'substantive prose to avoid skeleton detection.',
  '',
  'It represents actual maintained cognition coverage for the bar module.',
].join('\n');

function writeProjectFiles(tmpdir: string): void {
  fs.mkdirSync(path.join(tmpdir, '.coggit'), { recursive: true });
  fs.writeFileSync(
    path.join(tmpdir, '.coggit/config.yaml'),
    'source_root: src\ncognition_root: cog\n',
  );

  fs.mkdirSync(path.join(tmpdir, 'src/foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpdir, 'src/foo/bar.ts'), 'export const bar = 1;\n');

  fs.mkdirSync(path.join(tmpdir, 'cog/foo'), { recursive: true });
  fs.writeFileSync(path.join(tmpdir, 'cog/foo/README.md'), FOLDER_README);
  fs.writeFileSync(path.join(tmpdir, 'cog/foo/bar.ts.md'), LEAF_COGNITION);
}

async function openTmpProject(tmpdir: string): Promise<CoggitProject> {
  const services = createNodeCoggitServices({ workspacePath: tmpdir });
  const projects = await discoverCoggitProjects(services);
  assert.strictEqual(projects.length, 1, 'expected exactly one project in tmpdir');
  return projects[0];
}

function findNode(snapshot: Awaited<ReturnType<CoggitProject['buildSnapshot']>>, relPath: string) {
  return snapshot.allNodes.find((n) => n.relativePath === relPath);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

suite('tree disk E2E — real filesystem stale detection', () => {
  let tmpdir: string;

  setup(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'coggit-disk-'));
  });

  teardown(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  test('folder is fresh on first observation after reconcile', async () => {
    writeProjectFiles(tmpdir);
    const project = await openTmpProject(tmpdir);

    const snapshot = await project.buildSnapshot();
    const folder = findNode(snapshot, 'foo');

    assert.ok(folder, 'folder node "foo" should exist in snapshot');
    assert.strictEqual(folder.ownStatus?.observedStatus, 'fresh');
    assert.strictEqual(folder.status?.observedStatus, 'fresh');
  });

  test('folder becomes stale when a child file is added', async () => {
    writeProjectFiles(tmpdir);
    const project = await openTmpProject(tmpdir);

    // Baseline: fresh
    const before = await project.buildSnapshot();
    assert.strictEqual(findNode(before, 'foo')?.ownStatus?.observedStatus, 'fresh');

    // Mutate: add a new child to the folder
    fs.writeFileSync(path.join(tmpdir, 'src/foo/baz.ts'), 'export const baz = 2;\n');

    await project.ensureFresh();
    const after = await project.buildSnapshot();
    const folder = findNode(after, 'foo');

    assert.ok(folder);
    assert.strictEqual(
      folder.ownStatus?.observedStatus,
      'stale',
      'folder should be stale after a child file is added (structure drift)',
    );
    assert.ok(
      folder.ownStatus?.issues?.some((i) => i.diagnostic.code === 'folder-structure-outdated'),
      'expected folder-structure-outdated diagnostic',
    );
  });

  test('folder stays fresh when directory mtime changes but children do not', async () => {
    writeProjectFiles(tmpdir);
    const project = await openTmpProject(tmpdir);

    const before = await project.buildSnapshot();
    assert.strictEqual(findNode(before, 'foo')?.ownStatus?.observedStatus, 'fresh');

    // Touch the directory mtime without adding/removing children.
    // On real filesystems this happens when a child file is modified in-place.
    const now = new Date();
    fs.utimesSync(path.join(tmpdir, 'src/foo'), now, now);

    await project.ensureFresh();
    const after = await project.buildSnapshot();
    const folder = findNode(after, 'foo');

    assert.ok(folder);
    assert.strictEqual(
      folder.ownStatus?.observedStatus,
      'fresh',
      'directory mtime noise alone must not trigger stale (hash unchanged)',
    );
  });

  test('leaf file becomes stale when source mtime advances past cognition', async () => {
    writeProjectFiles(tmpdir);
    const project = await openTmpProject(tmpdir);

    const before = await project.buildSnapshot();
    assert.strictEqual(findNode(before, 'foo/bar.ts')?.ownStatus?.observedStatus, 'fresh');

    // Modify source and push its mtime into the future so it is unambiguously
    // newer than the cognition file regardless of filesystem mtime resolution.
    const future = new Date(Date.now() + 10_000);
    fs.writeFileSync(path.join(tmpdir, 'src/foo/bar.ts'), 'export const bar = 2;\n');
    fs.utimesSync(path.join(tmpdir, 'src/foo/bar.ts'), future, future);

    await project.ensureFresh();
    const after = await project.buildSnapshot();
    const file = findNode(after, 'foo/bar.ts');

    assert.ok(file);
    assert.strictEqual(
      file.ownStatus?.observedStatus,
      'stale',
      'leaf should be stale when source mtime > cognition mtime',
    );
    assert.ok(
      file.ownStatus?.issues?.some((i) => i.diagnostic.code === 'outdated-cognition'),
      'expected outdated-cognition diagnostic',
    );
  });

  test('leaf file stays fresh when only cognition is touched', async () => {
    writeProjectFiles(tmpdir);
    const project = await openTmpProject(tmpdir);

    const before = await project.buildSnapshot();
    assert.strictEqual(findNode(before, 'foo/bar.ts')?.ownStatus?.observedStatus, 'fresh');

    // Advance cognition mtime only — source is unchanged.
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(path.join(tmpdir, 'cog/foo/bar.ts.md'), future, future);

    await project.ensureFresh();
    const after = await project.buildSnapshot();
    const file = findNode(after, 'foo/bar.ts');

    assert.ok(file);
    assert.strictEqual(
      file.ownStatus?.observedStatus,
      'fresh',
      'advancing cognition mtime alone must keep the leaf fresh',
    );
  });
});
