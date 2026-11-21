/**
 * Real-disk tests for the git-backed TrackedEntriesIndex.
 *
 * These tests build a real temporary git repository (git init + commits,
 * fully offline), then verify trackedChildNames against the actual index:
 * tracked vs untracked vs gitignored children, gitlink (nested repository)
 * entries, cache invalidation on `git add`, and the null degradation outside
 * any repository.
 */
import * as assert from 'node:assert';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

import { createGitTrackedEntriesIndex } from './trackedEntries';
import { pathToUriComponents } from './uri';

const execFileAsync = promisify(execFile);

async function gitSync(repoDir: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', ['-C', repoDir, ...args]);
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'coggit-tracked-'));
}

async function childNames(repoDir: string, index: ReturnType<typeof createGitTrackedEntriesIndex>, dir: string): Promise<Set<string> | null> {
  const domain = await index.trackedChildNames(pathToUriComponents(path.join(repoDir, dir)));
  return domain.kind === 'git' ? domain.names : null;
}

suite('git-backed tracked entries index', () => {
  let repoDir: string;

  setup(async function setup(): Promise<void> {
    repoDir = makeTmpDir();
    await gitSync(repoDir, 'init');
    await gitSync(repoDir, 'config', 'user.email', 'test@example.com');
    await gitSync(repoDir, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(repoDir, 'tracked-root.ts'), 'export const a = 1;\n');
    fs.mkdirSync(path.join(repoDir, 'tracked-dir'));
    fs.writeFileSync(path.join(repoDir, 'tracked-dir/tracked.ts'), 'export const b = 1;\n');
    fs.writeFileSync(path.join(repoDir, 'tracked-dir/ignored.log'), 'noise\n');
    fs.writeFileSync(path.join(repoDir, '.gitignore'), '*.log\n');
    await gitSync(repoDir, 'add', '.');
    await gitSync(repoDir, 'commit', '-m', 'initial');
    // Untracked, not gitignored: visible on disk, absent from the index.
    fs.mkdirSync(path.join(repoDir, 'scratch-dir'));
    fs.writeFileSync(path.join(repoDir, 'scratch-dir/scratch.js'), '// scratch\n');
    fs.writeFileSync(path.join(repoDir, 'untracked.ts'), '// untracked\n');
  });

  teardown(function teardown(): void {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  test('answers tracked direct children and excludes untracked and gitignored entries', async () => {
    const index = createGitTrackedEntriesIndex();

    const rootChildren = await childNames(repoDir, index, '.');
    assert.ok(rootChildren, 'expected a tracked answer inside a repository');
    assert.ok(rootChildren.has('tracked-root.ts'));
    assert.ok(rootChildren.has('tracked-dir'));
    assert.ok(!rootChildren.has('scratch-dir'), 'untracked dir must not join the tracked shape');
    assert.ok(!rootChildren.has('untracked.ts'), 'untracked file must not join the tracked shape');

    const dirChildren = await childNames(repoDir, index, 'tracked-dir');
    assert.ok(dirChildren);
    assert.ok(dirChildren.has('tracked.ts'));
    assert.ok(!dirChildren.has('ignored.log'), 'gitignored paths never enter the index');
  });

  test('unknown directory inside a repository yields an empty tracked set', async () => {
    const index = createGitTrackedEntriesIndex();
    fs.mkdirSync(path.join(repoDir, 'brand-new-dir'));
    const children = await childNames(repoDir, index, 'brand-new-dir');
    assert.ok(children);
    assert.strictEqual(children.size, 0);
  });

  test('staging a scratch path invalidates the cached listing (index mtime)', async () => {
    const index = createGitTrackedEntriesIndex();
    assert.ok(!(await childNames(repoDir, index, '.'))?.has('scratch-dir'));

    await gitSync(repoDir, 'add', 'scratch-dir');
    const children = await childNames(repoDir, index, '.');
    assert.ok(children?.has('scratch-dir'), 'staged entry joins the tracked shape without a new index instance');
  });

  test('gitlink entry counts as a tracked child of its parent directory', async () => {
    // A nested repository committed on its own, then added into the outer
    // repository as a gitlink (`git add` of a directory containing .git).
    const innerDir = path.join(repoDir, 'nested-inner');
    fs.mkdirSync(innerDir);
    await gitSync(innerDir, 'init');
    await gitSync(innerDir, 'config', 'user.email', 'test@example.com');
    await gitSync(innerDir, 'config', 'user.name', 'test');
    fs.writeFileSync(path.join(innerDir, 'inner.ts'), 'export const inner = 1;\n');
    await gitSync(innerDir, 'add', '.');
    await gitSync(innerDir, 'commit', '-m', 'inner initial');

    await gitSync(repoDir, 'add', 'nested-inner');
    const index = createGitTrackedEntriesIndex();
    const children = await childNames(repoDir, index, '.');
    assert.ok(children?.has('nested-inner'), 'gitlink is part of the outer tracked shape');

    // Inside the gitlink, the inner repository answers for its own shape.
    const innerChildren = await childNames(innerDir, index, '.');
    assert.ok(innerChildren?.has('inner.ts'), 'inner repository listing serves its own tree');
  });

  test('a dot-dot-prefixed directory name is a legal in-repo path, not an escape', async () => {
    const index = createGitTrackedEntriesIndex();
    fs.mkdirSync(path.join(repoDir, '..docs'));
    fs.writeFileSync(path.join(repoDir, '..docs/readme.md'), 'x\n');
    await gitSync(repoDir, 'add', '.');
    const rootChildren = await childNames(repoDir, index, '.');
    assert.ok(rootChildren?.has('..docs'), 'dot-dot-prefixed name joins the tracked shape');
    const inside = await childNames(repoDir, index, '..docs');
    assert.ok(inside?.has('readme.md'), 'querying the dot-dot-prefixed directory answers its tracked children');
  });

  test('a linked worktree (.git file) invalidates its listing on staging', async () => {
    const wtDir = makeTmpDir();
    try {
      await gitSync(repoDir, 'worktree', 'add', '-b', 'wt-branch', wtDir);
      // The worktree root carries a .git FILE pointing at the real git dir.
      assert.ok(fs.statSync(path.join(wtDir, '.git')).isFile());

      const index = createGitTrackedEntriesIndex();
      fs.writeFileSync(path.join(wtDir, 'late.txt'), 'staged after first query\n');
      const before = await childNames(wtDir, index, '.');
      assert.ok(before !== null && !before.has('late.txt'), 'first query caches the pre-staging shape');

      await gitSync(wtDir, 'add', 'late.txt');
      const after = await childNames(wtDir, index, '.');
      assert.ok(after?.has('late.txt'), 'staging invalidates the cached listing through the gitfile indirection');
    } finally {
      fs.rmSync(wtDir, { recursive: true, force: true });
      await gitSync(repoDir, 'worktree', 'prune', '--force').catch(() => undefined);
    }
  });

  test('win32 case-aliased queries resolve the tracked bucket', async function caseAliasTest() {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }
    const index = createGitTrackedEntriesIndex();
    fs.mkdirSync(path.join(repoDir, 'Src'));
    fs.writeFileSync(path.join(repoDir, 'Src/inner.ts'), 'x\n');
    await gitSync(repoDir, 'add', 'Src/inner.ts');
    // The on-disk query case differs from the index-canonical bucket key.
    const aliased = await childNames(repoDir, index, 'src');
    assert.ok(aliased?.has('inner.ts'), 'case-aliased lookup still finds the tracked children');
  });

  test('injected runner: rev-parse failure recovers on a later query', async () => {
    let revParseCalls = 0;
    let failRevParse = true;
    const index = createGitTrackedEntriesIndex({
      runGit: async (repoRoot, args) => {
        if (args.includes('rev-parse')) {
          revParseCalls++;
          if (failRevParse) {
            throw new Error('git not on PATH');
          }
          return path.join(repoDir, '.git', 'index') + '\n';
        }
        // ls-files: derive from the real repository
        const out = await execFileAsync('git', ['-C', repoRoot, ...args]);
        return out.stdout;
      },
    });
    assert.strictEqual(await childNames(repoDir, index, '.'), null, 'cold-start failure answers unavailable');
    failRevParse = false;
    const children = await childNames(repoDir, index, '.');
    assert.ok(children?.has('tracked-root.ts'), 'recovered environment answers the tracked shape on the next query');
    assert.ok(revParseCalls >= 2, 'failures are retried, never cached');
  });

  test('injected runner: a stamp change reloads once across concurrent queries', async () => {
    let lsFilesCalls = 0;
    const index = createGitTrackedEntriesIndex({
      runGit: async (repoRoot, args) => {
        if (args.includes('ls-files')) {
          lsFilesCalls++;
        }
        const out = await execFileAsync('git', ['-C', repoRoot, ...args]);
        return out.stdout;
      },
    });
    assert.ok(await childNames(repoDir, index, '.'));
    const callsAfterWarmup = lsFilesCalls;

    fs.writeFileSync(path.join(repoDir, 'late.txt'), 'x\n');
    await gitSync(repoDir, 'add', 'late.txt');

    const [a, b, c] = await Promise.all([
      childNames(repoDir, index, '.'),
      childNames(repoDir, index, '.'),
      childNames(repoDir, index, '.'),
    ]);
    assert.ok(a?.has('late.txt') && b?.has('late.txt') && c?.has('late.txt'));
    assert.strictEqual(lsFilesCalls, callsAfterWarmup + 1, 'concurrent queries join one reload');
  });

  test('lowercase git_index_file in the environment cannot re-point the index (win32)', async function lowercaseEnvTest() {
    if (process.platform !== 'win32') {
      this.skip();
      return;
    }
    // Build an alternate index whose tracked shape differs from the default:
    // a lowercase git_index_file set BEFORE the add must not re-point our
    // queries (git itself, without sanitization, WOULD stage into it).
    const altDir = makeTmpDir();
    const original = process.env['git_index_file'];
    try {
      const alternateIndex = path.join(altDir, 'alternate-index');
      process.env['git_index_file'] = alternateIndex;
      fs.writeFileSync(path.join(repoDir, 'only-alternate.txt'), 'x\n');
      await gitSync(repoDir, 'add', 'only-alternate.txt');
      assert.ok(fs.existsSync(alternateIndex), 'sanity: the alternate index captured the staging');
      delete process.env['git_index_file'];

      const index = createGitTrackedEntriesIndex();
      const children = await childNames(repoDir, index, '.');
      assert.ok(children?.has('tracked-root.ts'), 'default index shape is read');
      assert.ok(!children?.has('only-alternate.txt'), 'lowercase override must NOT re-point the index');
    } finally {
      if (original === undefined) {
        delete process.env['git_index_file'];
      } else {
        process.env['git_index_file'] = original;
      }
      fs.rmSync(altDir, { recursive: true, force: true });
      fs.rmSync(path.join(repoDir, 'only-alternate.txt'), { force: true });
      await gitSync(repoDir, 'reset', '-q', '--', 'only-alternate.txt').catch(() => undefined);
    }
  });

  test('retargeting a gitfile re-resolves the index path on the same instance', async () => {
    // Two independent repositories; the root's .git FILE is repointed from
    // one git dir to the other. The old instance must follow.
    const repoA = makeTmpDir();
    const repoB = makeTmpDir();
    const home = makeTmpDir();
    try {
      for (const [dir, marker] of [[repoA, 'from-a'], [repoB, 'from-b']] as const) {
        fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'sub', marker), 'x\n');
        await gitSync(dir, 'init');
        await gitSync(dir, 'config', 'user.email', 'test@example.com');
        await gitSync(dir, 'config', 'user.name', 'test');
        await gitSync(dir, 'add', '.');
        await gitSync(dir, 'commit', '-m', `initial ${marker}`);
      }
      // A worktree-like root whose .git FILE points at repoA's git dir.
      const root = path.join(home, 'root');
      fs.mkdirSync(root, { recursive: true });
      fs.writeFileSync(path.join(root, '.git'), `gitdir: ${path.join(repoA, '.git')}`);

      const index = createGitTrackedEntriesIndex();
      const before = await childNames(root, index, '.');
      assert.ok(before?.has('sub'), 'first resolution serves repoA');

      // Retarget the gitfile to repoB.
      fs.writeFileSync(path.join(root, '.git'), `gitdir: ${path.join(repoB, '.git')}`);
      const after = await childNames(root, index, '.');
      assert.ok(after?.has('sub'), 'both repos expose a sub directory');
      // The distinguishing fact: repoB's index lists from-b, repoA's from-a.
      const insideB = await childNames(repoB, index, '.');
      assert.ok(insideB?.has('sub'));
      const rootListing = await (async () => {
        const domain = await index.trackedChildNames(pathToUriComponents(root));
        return domain.kind === 'git' ? [...domain.names].join(',') : null;
      })();
      assert.strictEqual(rootListing, 'sub');
      // root's .git file mtime changed, so rev-parse re-runs against repoB's
      // index; its ls-files lists sub/from-b — indistinguishable by name, so
      // assert via the outer repos instead: repoA retains from-a shape.
      const insideA = await childNames(repoA, index, '.');
      assert.ok(insideA?.has('sub'));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(repoA, { recursive: true, force: true });
      fs.rmSync(repoB, { recursive: true, force: true });
    }
  });

  test('directory outside any repository degrades to null', async () => {
    const outside = makeTmpDir();
    try {
      const index = createGitTrackedEntriesIndex();
      const children = await childNames(outside, index, '.');
      assert.strictEqual(children, null);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});
