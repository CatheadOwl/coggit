import type { UriComponents } from './interfaces';

export interface ProjectLockContext {
  readonly owner: 'vscode' | 'mcp' | 'cli' | 'daemon' | string;
  readonly operation: string;
  readonly projectLabel?: string;
}

/**
 * Host-neutral coordinator for serializing protected project write sessions.
 *
 * Implementations are NOT reentrant: calling `withWriteLock` from within `fn`
 * on the same project root will block until the outer lock is released, causing
 * a deadlock or bounded-timeout error. Callers must not nest lock acquisitions.
 */
export interface ProjectLockManager {
  withWriteLock<T>(
    projectRoot: UriComponents,
    context: ProjectLockContext,
    fn: () => Promise<T>,
  ): Promise<T>;
}

export class ProjectLockError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: ProjectLockContext,
  ) {
    super(message);
    this.name = 'ProjectLockError';
  }
}

export const noOpProjectLockManager: ProjectLockManager = {
  async withWriteLock(_projectRoot, _context, fn) {
    return fn();
  },
};

/** A held watch lease. Renew keeps the lease from going stale; release ends it. */
export interface WatchLeaseHandle {
  renew(): Promise<void>; // throws WatchLeaseError('reclaimed') if the lease was taken over
  release(): Promise<void>;
}

/**
 * Host-neutral coordinator for single-writer watcher leases.
 *
 * Unlike `ProjectLockManager`, acquisition never blocks: a caller either
 * becomes the sole holder immediately or backs off to reconcile-on-read.
 */
export interface WatchLeaseManager {
  /**
   * Non-blocking try-acquire. Returns null when a live holder exists (the
   * caller declines watching and falls back to reconcile-on-read). Never waits.
   */
  tryAcquireWatchLease(
    projectRoot: UriComponents,
    context: ProjectLockContext,
  ): Promise<WatchLeaseHandle | null>;
}

export class WatchLeaseError extends ProjectLockError {
  constructor(
    message: string,
    code: string,
    context?: ProjectLockContext,
  ) {
    super(message, code, context);
    this.name = 'WatchLeaseError';
  }
}

export const noOpWatchLeaseManager: WatchLeaseManager = {
  async tryAcquireWatchLease(_projectRoot, _context) {
    return null;
  },
};
