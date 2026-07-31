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
