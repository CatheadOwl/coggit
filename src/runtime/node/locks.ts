import * as nodeFs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  ProjectLockError,
  type ProjectLockContext,
  type ProjectLockManager,
} from '../../core/locks';
import type { UriComponents } from '../../core/interfaces';
import { uriComponentsToPath } from './uri';

export interface NodeProjectLockManagerOptions {
  readonly waitTimeoutMs?: number;
  readonly pollIntervalMs?: number;
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

export class NodeProjectLockManager implements ProjectLockManager {
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private readonly hostname = os.hostname();

  constructor(options: NodeProjectLockManagerOptions = {}) {
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
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
    const lock: LockFile = {
      token,
      pid: process.pid,
      hostname: this.hostname,
      acquiredAt: new Date().toISOString(),
      context,
    };

    while (true) {
      try {
        await nodeFs.mkdir(path.dirname(lockPath), { recursive: true });
        // 'wx' (O_EXCL) is racy on NFS; accepted limitation, see ADR 0014.
        const handle = await nodeFs.open(lockPath, 'wx');
        try {
          await handle.writeFile(JSON.stringify(lock, null, 2), 'utf8');
        } finally {
          await handle.close();
        }
        return lock;
      } catch (error) {
        if (!isFileExistsError(error)) {
          throw error;
        }

        const holder = await this.inspectExistingLock(lockPath);
        if (holder.stale) {
          if (await this.reclaimStaleLock(lockPath)) {
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
  }

  private async inspectExistingLock(
    lockPath: string,
  ): Promise<{ lock: LockFile | null; stale: boolean }> {
    const [lock, stat] = await Promise.all([
      readLockFile(lockPath),
      nodeFs.stat(lockPath).catch(() => null),
    ]);
    const ageMs = Date.now() - (lock ? Date.parse(lock.acquiredAt) : stat?.mtimeMs ?? Date.now());
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

  private async reclaimStaleLock(lockPath: string): Promise<boolean> {
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

  private async release(lockPath: string, token: string): Promise<void> {
    const lock = await readLockFile(lockPath);
    if (!lock || lock.token !== token) {
      return;
    }
    await removeFileIfExists(lockPath);
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
