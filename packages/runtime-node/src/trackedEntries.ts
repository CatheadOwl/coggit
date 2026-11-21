import { execFile } from 'node:child_process';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';

import type { TrackedEntriesIndex, TrackedShapeDomain, UriComponents } from '@coggit/core';
import { uriComponentsToPath } from './uri';

const execFileAsync = promisify(execFile);

const GIT_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const LOAD_RACE_RETRIES = 3;

const NO_GIT: TrackedShapeDomain = { kind: 'non-git' };
const UNAVAILABLE: TrackedShapeDomain = { kind: 'unavailable' };

/** Tracked-shape listing for one owning repository, keyed by repo-root-relative posix dir. */
interface RepoListing {
  /** The index file this listing was read from (re-targeting invalidates). */
  indexPath: string;
  /** Stamp of the git index the listing was read against. */
  indexStamp: IndexStamp;
  byDir: Map<string, Set<string>>;
}

interface IndexStamp {
  stampMs: number;
  sizeBytes: number;
}

const EMPTY_STAMP: IndexStamp = { stampMs: 0, sizeBytes: 0 };

function stampsEqual(left: IndexStamp, right: IndexStamp): boolean {
  return left.stampMs === right.stampMs && left.sizeBytes === right.sizeBytes;
}

/**
 * Directory name → direct children that belong to the git-tracked shape.
 *
 * Backed by `git ls-files` over the queried directory's owning repository
 * (found by probing `.git` upward; the probe accepts both `.git` files and
 * directories, so submodule and linked-worktree trees resolve through their
 * real git dir). One listing per repository serves every directory inside
 * it: a tracked path contributes its segment to each ancestor directory,
 * and a gitlink entry (a committed submodule path) counts as a tracked
 * child of its parent — the submodule's own interior is answered by the
 * inner listing.
 *
 * The cache binds to the index git itself uses: the index path is resolved
 * per repository with `git rev-parse --path-format=absolute --git-path
 * index` (which honors worktrees, gitfiles, and GIT_INDEX_FILE), and the
 * cached listing carries that file's mtime+size stamp. Staging invalidates
 * on the next query. The listing is only accepted when the stamp read
 * before and after `ls-files` agrees, so an index swap mid-read cannot be
 * cached as current; the stamp is a heuristic — a same-mtime same-size
 * index swap can evade it, the next real stamp change recovers.
 *
 * Failures are never cached: a transient git failure answers
 * `unavailable` for this query and the next query retries. Only a
 * directory outside any repository answers `non-git`, the stable fallback
 * domain where callers count every on-disk entry.
 */
/** Overrides for tests: swap the git runner to inject failures and count invocations. */
export interface GitTrackedEntriesOptions {
  /** `env` carries the resolved GIT_INDEX_FILE binding for index reads; runners that spawn git should apply it. */
  runGit?: (repoRoot: string, args: string[], env: NodeJS.ProcessEnv) => Promise<string>;
}

/**
 * Git environment stripped of path-override variables: an inherited
 * GIT_INDEX_FILE / GIT_DIR / GIT_WORK_TREE would silently re-point every
 * query and stamp at an alternate index, and whether that should count as
 * the project's authoritative shape is policy — not an accident of the
 * first query's environment. All git calls of one service instance see the
 * same, default resolution.
 */
const GIT_PATH_OVERRIDE_KEYS = new Set(['GIT_INDEX_FILE', 'GIT_DIR', 'GIT_WORK_TREE']);

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Windows environment keys are case-insensitive: git_index_file and
    // GIT_INDEX_FILE both override the index path, so match by upper case.
    if (GIT_PATH_OVERRIDE_KEYS.has(key.toUpperCase())) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

export function createGitTrackedEntriesIndex(options: GitTrackedEntriesOptions = {}): TrackedEntriesIndex {
  const runGitImpl = options.runGit ?? ((repoRoot: string, args: string[], env?: NodeJS.ProcessEnv) =>
    execFileAsync('git', ['-C', repoRoot, ...args], {
      maxBuffer: GIT_MAX_BUFFER_BYTES,
      env: env ?? sanitizedEnv() as NodeJS.ProcessEnv,
    }).then((result) => result.stdout));

  const listings = new Map<string, Promise<RepoListing | null>>();
  const reloads = new Map<string, Promise<RepoListing | null>>();
  const indexPaths = new Map<string, { path: string; gitFileStamp: IndexStamp | 'dir' | 'absent' }>();

  function runGit(repoRoot: string, args: string[], env: NodeJS.ProcessEnv = sanitizedEnv()): Promise<string> {
    return runGitImpl(repoRoot, args, env);
  }

  async function statIndexStamp(indexPath: string): Promise<IndexStamp> {
    try {
      const stat = await fsp.stat(indexPath);
      return { stampMs: stat.mtimeMs, sizeBytes: stat.size };
    } catch {
      // Fresh repository without any staged path: no index file yet.
      return EMPTY_STAMP;
    }
  }

  /**
   * Absolute path of the index git reads for this repository, memoized —
   * successes only. A failure (git missing at cold start, transient error)
   * is answered per query and retried on the next one, so a recovered
   * environment heals without a new service instance.
   */
  /**
   * Absolute path of the index git reads for this repository. Successes are
   * memoized together with the stamp of the `.git` entry that produced them:
   * when `.git` is a FILE (worktrees, gitfile submodules), retargeting that
   * file to another git dir must re-run rev-parse, otherwise the instance
   * would keep validating and listing a git dir that is no longer current.
   * Failures are never memoized — a recovered environment heals on the next
   * query.
   */
  async function indexPathFor(repoRoot: string): Promise<string | null> {
    const gitEntryStamp = await stampGitEntry(repoRoot);
    const known = indexPaths.get(repoRoot);
    if (known && sameStamp(known.gitFileStamp, gitEntryStamp)) {
      return known.path;
    }
    try {
      const out = await runGit(repoRoot, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
      const resolved = out.trim();
      if (!resolved) {
        return null;
      }
      const absolute = path.isAbsolute(resolved) ? resolved : path.resolve(repoRoot, resolved);
      indexPaths.set(repoRoot, { path: absolute, gitFileStamp: gitEntryStamp });
      return absolute;
    } catch {
      return null;
    }
  }

  /** Stamp of the repository's `.git` entry: 'dir' for a directory, file stamps for a gitfile, absent when probe-error or missing. */
  async function stampGitEntry(repoRoot: string): Promise<IndexStamp | 'dir' | 'absent'> {
    try {
      const stat = await fsp.stat(path.join(repoRoot, '.git'));
      if (stat.isDirectory()) {
        return 'dir';
      }
      return { stampMs: stat.mtimeMs, sizeBytes: stat.size };
    } catch {
      return 'absent';
    }
  }

  function sameStamp(left: IndexStamp | 'dir' | 'absent', right: IndexStamp | 'dir' | 'absent'): boolean {
    if (left === 'dir' || right === 'dir' || left === 'absent' || right === 'absent') {
      return left === right;
    }
    return stampsEqual(left, right);
  }

  async function loadListing(repoRoot: string): Promise<RepoListing | null> {
    const indexPath = await indexPathFor(repoRoot);
    if (!indexPath) {
      return null;
    }
    for (let attempt = 0; attempt < LOAD_RACE_RETRIES; attempt++) {
      const stampBefore = await statIndexStamp(indexPath);
      let stdout: string;
      try {
        // Pin the listing to the resolved binding: the sanitized env plus
        // GIT_INDEX_FILE at the resolved path, so the read provably
        // describes the same index file the stamps validate — a gitfile
        // retarget mid-read cannot substitute another index's output.
        const env = sanitizedEnv();
        env.GIT_INDEX_FILE = indexPath;
        stdout = await runGit(repoRoot, ['ls-files', '--full-name', '-z'], env);
      } catch {
        return null;
      }
      const stampAfter = await statIndexStamp(indexPath);
      // The listing only describes the index it was read against; a swap
      // during the read means the pair (listing, stamp) would disagree with
      // reality on every later lookup until the next index change.
      if (!stampsEqual(stampBefore, stampAfter)) {
        continue;
      }
      return { indexPath, indexStamp: stampAfter, byDir: bucketize(stdout) };
    }
    return null;
  }

  function bucketize(stdout: string): Map<string, Set<string>> {
    const byDir = new Map<string, Set<string>>();
    const addChild = (dirKey: string, name: string) => {
      let children = byDir.get(dirKey);
      if (!children) {
        children = new Set<string>();
        byDir.set(dirKey, children);
      }
      children.add(name);
    };
    for (const entry of stdout.split('\0')) {
      if (!entry) {
        continue;
      }
      const segments = entry.split('/');
      for (let depth = 0; depth < segments.length; depth++) {
        const dirKey = depth === 0 ? '.' : segments.slice(0, depth).join('/');
        addChild(dirKey, segments[depth]);
      }
    }
    return byDir;
  }

  function listingFor(repoRoot: string): Promise<RepoListing | null> {
    let listing = listings.get(repoRoot);
    if (!listing) {
      listing = loadListing(repoRoot);
      listings.set(repoRoot, listing);
    }
    return listing;
  }

  async function currentListing(repoRoot: string): Promise<RepoListing | null> {
    const cached = await listingFor(repoRoot);
    const indexPath = await indexPathFor(repoRoot);
    if (!indexPath) {
      return null;
    }
    const stamp = await statIndexStamp(indexPath);
    // A cache hit requires the SAME index file, not just a same-looking
    // stamp: retargeting a gitfile to another git dir whose index happens
    // to carry an equal mtime+size must not serve the old listing.
    if (cached && cached.indexPath === indexPath && stampsEqual(cached.indexStamp, stamp)) {
      return cached;
    }
    // Single-flight: every concurrent query joins the one in-flight reload
    // instead of stampeding git with its own listing run.
    const reloadKey = `${repoRoot} ${indexPath}`;
    const pending = reloads.get(reloadKey);
    if (pending) {
      return pending;
    }
    const reloaded = loadListing(repoRoot).finally(() => reloads.delete(reloadKey));
    reloads.set(reloadKey, reloaded);
    listings.set(repoRoot, reloaded);
    return reloaded;
  }

  async function findOwningRepoRoot(startDir: string): Promise<string | null | 'probe-error'> {
    let current = startDir;
    for (;;) {
      try {
        await fsp.stat(path.join(current, '.git'));
        return current;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code !== 'ENOENT') {
          // A permission or I/O error is NOT evidence of absence: claiming
          // non-git here could silently walk past a repository boundary.
          return 'probe-error';
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }

  return {
    async trackedChildNames(directoryUri: UriComponents): Promise<TrackedShapeDomain> {
      let dirPath: string;
      try {
        dirPath = uriComponentsToPath(directoryUri);
      } catch {
        // Non-filesystem URI universes have no git shape to consult.
        return NO_GIT;
      }
      const repoRoot = await findOwningRepoRoot(dirPath);
      if (repoRoot === 'probe-error') {
        return UNAVAILABLE;
      }
      if (repoRoot === null) {
        return NO_GIT;
      }
      const listing = await currentListing(repoRoot);
      if (!listing) {
        return UNAVAILABLE;
      }
      const relative = path.relative(repoRoot, dirPath);
      // A leading '..' SEGMENT means outside; '..docs' is a legal in-repo
      // directory name and must not read as an escape.
      const firstSegment = relative.split(path.sep)[0];
      if (firstSegment === '..') {
        return UNAVAILABLE;
      }
      const dirKey = relative === '' ? '.' : relative.split(path.sep).join('/');
      const lookupKey = process.platform === 'win32' ? dirKey.toLowerCase() : dirKey;
      let names = listing.byDir.get(lookupKey);
      if (names === undefined && process.platform === 'win32') {
        for (const [key, value] of listing.byDir) {
          if (key.toLowerCase() === lookupKey) {
            names = value;
            break;
          }
        }
      }
      return { kind: 'git', names: names ?? new Set<string>() };
    },
  };
}
