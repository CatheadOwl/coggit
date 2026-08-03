import { Dirent, Stats, watch, type FSWatcher } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';

import type { CoggitWorkspaceRoot, WatchObservation, WatchObservationHandler, WatchObserver, WatchObserverSubscription } from '../../core';
import type { WatchEventDomain, WatchFileChangeKind } from '../../core';
import type { UriComponents } from '../../core/interfaces';
import { pathToUriComponents, uriComponentsToPath } from './uri';

interface WatchTarget {
  readonly domain: WatchEventDomain;
  readonly rootId: string;
  readonly rootPath: string;
}

interface WatchedDirectory {
  readonly target: WatchTarget;
  readonly directoryPath: string;
  readonly watcher: FSWatcher;
}

export interface NodeFileWatchObserverOptions {
  readonly roots: readonly CoggitWorkspaceRoot[];
  readonly persistent?: boolean;
  readonly now?: () => number;
  readonly onError?: (error: Error) => void;
}

export function createNodeFileWatchObserver(
  options: NodeFileWatchObserverOptions,
): WatchObserver {
  return new NodeFileWatchObserver(options);
}

class NodeFileWatchObserver implements WatchObserver {
  private readonly watchers = new Map<string, WatchedDirectory>();
  private delivery = Promise.resolve();
  private disposed = false;

  constructor(private readonly options: NodeFileWatchObserverOptions) {}

  subscribe(handler: WatchObservationHandler): WatchObserverSubscription {
    this.disposed = false;
    void this.start(handler).catch((error: unknown) => this.reportError(error));

    return {
      dispose: () => {
        this.disposed = true;
        for (const watched of this.watchers.values()) {
          watched.watcher.close();
        }
        this.watchers.clear();
      },
    };
  }

  private async start(handler: WatchObservationHandler): Promise<void> {
    const targets = this.watchTargets();
    await Promise.all(targets.map((target) =>
      this.watchDirectoryTree(target.rootPath, target, handler),
    ));
  }

  private watchTargets(): WatchTarget[] {
    const targets: WatchTarget[] = [];
    for (const root of this.options.roots) {
      targets.push({
        domain: 'source',
        rootId: root.id,
        rootPath: path.resolve(uriPath(root.sourceRootUri)),
      });
      targets.push({
        domain: 'cognition',
        rootId: root.id,
        rootPath: path.resolve(uriPath(root.cognitionRootUri)),
      });
      targets.push({
        domain: 'config',
        rootId: root.id,
        rootPath: path.dirname(path.resolve(uriPath(root.configUri))),
      });
    }
    return targets;
  }

  private async watchDirectoryTree(
    directoryPath: string,
    target: WatchTarget,
    handler: WatchObservationHandler,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const stat = await safeStat(directoryPath);
    if (!stat?.isDirectory()) {
      return;
    }

    this.watchDirectory(directoryPath, target, handler);

    const entries = await safeReadDirectory(directoryPath);
    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.watchDirectoryTree(
        path.join(directoryPath, entry.name),
        target,
        handler,
      )));
  }

  private watchDirectory(
    directoryPath: string,
    target: WatchTarget,
    handler: WatchObservationHandler,
  ): void {
    const normalizedDirectoryPath = path.resolve(directoryPath);
    const watchKey = watchKeyFor(target, normalizedDirectoryPath);
    if (this.watchers.has(watchKey) || this.disposed) {
      return;
    }

    let watcher: FSWatcher;
    try {
      watcher = watch(directoryPath, {
        persistent: this.options.persistent ?? false,
      }, (eventType, filename) => {
        const observedAtMs = this.options.now?.() ?? Date.now();
        const changedPath = resolveChangedPath(directoryPath, filename);
        this.delivery = this.delivery
          .then(() => this.deliver(target, changedPath, eventType, observedAtMs, handler))
          .catch((error: unknown) => this.reportError(error));
      });
    } catch (error) {
      this.reportError(error);
      return;
    }

    watcher.on('error', (error) => this.reportError(error));
    this.watchers.set(watchKey, {
      target,
      directoryPath: normalizedDirectoryPath,
      watcher,
    });
  }

  private async deliver(
    target: WatchTarget,
    changedPath: string,
    eventType: string,
    observedAtMs: number,
    handler: WatchObservationHandler,
  ): Promise<void> {
    if (this.disposed) {
      return;
    }

    const normalizedChangedPath = path.resolve(changedPath);
    const stat = await safeStat(normalizedChangedPath);
    if (target.domain === 'source' || target.domain === 'cognition') {
      if (stat?.isDirectory()) {
        await this.watchDirectoryTree(normalizedChangedPath, target, handler);
      } else if (!stat) {
        this.unwatchDirectoryTree(target, normalizedChangedPath);
      }
    }

    const observation = toObservation(target, normalizedChangedPath, eventType, stat, observedAtMs);
    if (!observation) {
      return;
    }
    await handler(observation);
  }

  private unwatchDirectoryTree(target: WatchTarget, deletedPath: string): void {
    for (const [watchKey, watched] of this.watchers.entries()) {
      if (
        watched.target.rootId === target.rootId
        && watched.target.domain === target.domain
        && isEqualOrChildPath(deletedPath, watched.directoryPath)
      ) {
        watched.watcher.close();
        this.watchers.delete(watchKey);
      }
    }
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.options.onError?.(normalized);
  }
}

function toObservation(
  target: WatchTarget,
  changedPath: string,
  eventType: string,
  stat: Stats | undefined,
  observedAtMs: number,
): WatchObservation | undefined {
  if (target.domain === 'config' && path.basename(changedPath) !== 'config.yaml') {
    return undefined;
  }

  return {
    domain: target.domain,
    uri: pathToUriComponents(changedPath),
    kind: changeKind(eventType, stat),
    observedAtMs,
  };
}

function changeKind(eventType: string, stat: Stats | undefined): WatchFileChangeKind {
  if (eventType === 'rename') {
    return stat ? 'create' : 'delete';
  }
  return stat ? 'change' : 'delete';
}

function resolveChangedPath(directoryPath: string, filename: string | Buffer | null): string {
  if (!filename) {
    return directoryPath;
  }
  return path.resolve(directoryPath, filename.toString());
}

function watchKeyFor(target: WatchTarget, directoryPath: string): string {
  return `${target.rootId}:${target.domain}:${pathIdentity(directoryPath)}`;
}

function isEqualOrChildPath(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (
    relative.length > 0
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
  );
}

function pathIdentity(filePath: string): string {
  const normalized = path.normalize(filePath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

async function safeStat(filePath: string): Promise<Stats | undefined> {
  try {
    return await nodeFs.stat(filePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function safeReadDirectory(directoryPath: string): Promise<Dirent[]> {
  try {
    return await nodeFs.readdir(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function uriPath(uri: UriComponents): string {
  return uriComponentsToPath(uri);
}
