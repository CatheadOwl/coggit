import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  ProjectLockError,
  WatchLeaseError,
  type ProjectLockContext,
  type ProjectLockManager,
  type WatchLeaseHandle,
  type WatchLeaseManager,
} from '../../core/locks';
import type { UriComponents } from '../../core/interfaces';
import { uriComponentsToPath } from './uri';

export interface NodeProjectLockManagerOptions {
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly staleAfterMs?: number;
}

export interface NodeWatchLeaseManagerOptions {
  readonly staleAfterMs?: number;
}

interface LockFile {
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly acquiredAt: string;
  readonly context: ProjectLockContext;
}

const DEFAULT_WAIT_TIMEOUT_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_STALE_AFTER_MS = 120000;

class NodeLockFileStore {
  constructor(
    private readonly staleAfterMs: number,
    private readonly hostname = os.hostname(),
  ) {}

  createLock(token: string, context: ProjectLockContext): LockFile {
    return {
      token,
      pid: process.pid,
      hostname: this.hostname,
      acquiredAt: new Date().toISOString(),
      context,
    };
  }

  async tryCreate(lockPath: string, lock: LockFile): Promise<boolean> {
    try {
      await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
      // 'wx' (O_EXCL) is racy on NFS; accepted limitation, see ADR 0014.
      const handle = await nodeFs.open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify(lock, null, 2), 'utf8');
      } finally {
        await handle.close();
      }
      return true;
    } catch (error) {
      if (isFileExistsError(error)) {
        return false;
      }
      throw error;
    }
  }

  async inspectExistingLock(
    lockPath: string,
  ): Promise<{ lock: LockFile | null; stale: boolean }> {
    const [lock, stat] = await Promise.all([
      readLockFile(lockPath),
      nodeFs.stat(lockPath).catch(() => null),
    ]);
    const acquiredAtMs = lock ? Date.parse(lock.acquiredAt) : undefined;
    const observedAtMs = acquiredAtMs !== undefined && !Number.isNaN(acquiredAtMs)
      ? acquiredAtMs
      : stat?.mtimeMs ?? Date.now();
    const ageMs = Date.now() - observedAtMs;
    if (ageMs < this.staleAfterMs) {
      return { lock, stale: false };
    }

    if (!lock) {
      return { lock, stale: true };
    }

    if (lock.hostname !== this.hostname) {
      return { lock, stale: false };
    }

    return { lock, stale: !isProcessAlive(lock.pid) };
  }

  async reclaimStaleLock(lockPath: string): Promise<boolean> {
    const reclaimPath = `${lockPath}.reclaim`;
    if (!(await tryCreateDirectory(reclaimPath))) {
      return false;
    }

    try {
      const holder = await this.inspectExistingLock(lockPath);
      if (!holder.stale) {
        return false;
      }
      await removeFileIfExists(lockPath);
      return true;
    } finally {
      await removeDirectoryIfExists(reclaimPath);
    }
  }

  async renew(lockPath: string, token: string, context: ProjectLockContext): Promise<void> {
    const lock = await readLockFile(lockPath);
    if (!lock || lock.token !== token) {
      throw new WatchLeaseError(
        `CogGit watch lease at "${lockPath}" was reclaimed`,
        'COGGIT_WATCH_LEASE_RECLAIMED',
        context,
      );
    }

    const renewed: LockFile = {
      ...lock,
      acquiredAt: new Date().toISOString(),
    };
    await nodeFs.writeFile(lockPath, JSON.stringify(renewed, null, 2), 'utf8');
  }

  async release(lockPath: string, token: string): Promise<void> {
    const lock = await readLockFile(lockPath);
    if (!lock || lock.token !== token) {
      return;
    }
    await removeFileIfExists(lockPath);
  }
}

export class NodeProjectLockManager implements ProjectLockManager {
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly lockStore: NodeLockFileStore;

  constructor(options: NodeProjectLockManagerOptions = {}) {
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.lockStore = new NodeLockFileStore(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  }

  async withWriteLock<T>(
    projectRoot: UriComponents,
    context: ProjectLockContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockPath = projectWriteLockPath(projectRoot);
    const token = randomUUID();
    const acquired = await this.acquire(lockPath, token, context);

    try {
      return await fn();
    } finally {
      await this.release(lockPath, acquired.token);
    }
  }

  private async acquire(
    lockPath: string,
    token: string,
    context: ProjectLockContext,
  ): Promise<LockFile> {
    const startedAt = Date.now();
    const lock = this.lockStore.createLock(token, context);

    while (true) {
      if (await this.lockStore.tryCreate(lockPath, lock)) {
        return lock;
      }

      const holder = await this.lockStore.inspectExistingLock(lockPath);
      if (holder.stale) {
        if (await this.lockStore.reclaimStaleLock(lockPath)) {
          continue;
        }
        await sleep(this.pollIntervalMs);
        continue;
      }

      if (Date.now() - startedAt >= this.waitTimeoutMs) {
        throw new ProjectLockError(
          `Timed out waiting for CogGit write lock at "${lockPath}"${formatHolder(holder.lock)}`,
          'COGGIT_WRITE_LOCK_BUSY',
          context,
        );
      }

      await sleep(this.pollIntervalMs);
    }
  }

  private async release(lockPath: string, token: string): Promise<void> {
    await this.lockStore.release(lockPath, token);
  }
}

export class NodeWatchLeaseManager implements WatchLeaseManager {
  private readonly lockStore: NodeLockFileStore;

  constructor(options: NodeWatchLeaseManagerOptions = {}) {
    this.lockStore = new NodeLockFileStore(options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS);
  }

  async tryAcquireWatchLease(
    projectRoot: UriComponents,
    context: ProjectLockContext,
  ): Promise<WatchLeaseHandle | null> {
    const lockPath = watchLeaseLockPath(projectRoot);
    const token = randomUUID();
    const lock = this.lockStore.createLock(token, context);
    let mayRetryAfterReclaim = true;

    while (true) {
      if (await this.lockStore.tryCreate(lockPath, lock)) {
        return {
          renew: async () => this.lockStore.renew(lockPath, token, context),
          release: async () => this.lockStore.release(lockPath, token),
        };
      }

      const holder = await this.lockStore.inspectExistingLock(lockPath);
      if (
        mayRetryAfterReclaim
        && holder.stale
        && await this.lockStore.reclaimStaleLock(lockPath)
      ) {
        mayRetryAfterReclaim = false;
        continue;
      }

      return null;
    }
  }
}

export function projectWriteLockPath(projectRoot: UriComponents): string {
  return path.join(
    uriComponentsToPath(projectRoot),
    '.coggit',
    'runtime',
    'locks',
    'write.lock',
  );
}

export function watchLeaseLockPath(projectRoot: UriComponents): string {
  return path.join(
    uriComponentsToPath(projectRoot),
    '.coggit',
    'runtime',
    'locks',
    'watch.lock',
  );
}

function formatHolder(lock: LockFile | null): string {
  if (!lock) {
    return '';
  }
  return `; holder pid=${lock.pid}, owner=${lock.context.owner}, operation=${lock.context.operation}`;
}

async function readLockFile(lockPath: string): Promise<LockFile | null> {
  try {
    const raw = await nodeFs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LockFile>;
    if (
      typeof parsed.token !== 'string'
      || typeof parsed.pid !== 'number'
      || typeof parsed.hostname !== 'string'
      || typeof parsed.acquiredAt !== 'string'
      || !parsed.context
      || typeof parsed.context.owner !== 'string'
      || typeof parsed.context.operation !== 'string'
    ) {
      return null;
    }
    return parsed as LockFile;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function removeFileIfExists(filePath: string): Promise<void> {
  try {
    await nodeFs.unlink(filePath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

async function tryCreateDirectory(dirPath: string): Promise<boolean> {
  try {
    await nodeFs.mkdir(dirPath);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

async function removeDirectoryIfExists(dirPath: string): Promise<void> {
  try {
    await nodeFs.rmdir(dirPath);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error;
    }
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
