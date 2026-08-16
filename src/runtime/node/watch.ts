import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import ParcelWatcher = require('@parcel/watcher');

import type {
  CoggitWorkspaceRoot,
  WatchObservation,
  WatchObservationHandler,
  WatchObserver,
  WatchObserverSubscription,
} from '../../core';
import type { WatchEventDomain, WatchFileChangeKind } from '../../core';
import type { UriComponents } from '../../core/interfaces';
import { pathToUriComponents, uriComponentsToPath } from './uri';

interface WatchTarget {
  readonly domain: WatchEventDomain;
  readonly rootPath: string;
}

type ParcelSubscribe = typeof ParcelWatcher.subscribe;

export interface NodeFileWatchObserverOptions {
  readonly roots: readonly CoggitWorkspaceRoot[];
  readonly now?: () => number;
  readonly onError?: (error: Error) => void;
  readonly subscribe?: ParcelSubscribe;
}

/**
 * @parcel/watcher-backed `WatchObserver` for the Node runtime.
 *
 * This adapter feeds the same `WatchObservation` stream into the CogGit-owned
 * watch host as any other `WatchObserver`; only the underlying filesystem
 * subscription differs. `@parcel/watcher` is a native recursive watcher, so the
 * previous hand-rolled `node:fs.watch` directory recursion (and its rename /
 * subtree re-watch bookkeeping) is no longer needed.
 */
export function createNodeFileWatchObserver(
  options: NodeFileWatchObserverOptions,
): WatchObserver {
  return new NodeFileWatchObserver(options);
}

class NodeFileWatchObserver implements WatchObserver {
  private readonly subscriptions: ParcelWatcher.AsyncSubscription[] = [];
  private delivery = Promise.resolve();
  private generation = 0;
  private readonly subscribeFn: ParcelSubscribe;

  constructor(private readonly options: NodeFileWatchObserverOptions) {
    this.subscribeFn = options.subscribe ?? ParcelWatcher.subscribe;
  }

  subscribe(handler: WatchObservationHandler): WatchObserverSubscription {
    const generation = ++this.generation;
    void this.start(generation, handler).catch((error: unknown) => this.reportError(error));

    return {
      dispose: () => {
        // Invalidate any in-flight starts so a subscription that resolves after
        // dispose (or after a later subscribe) is unsubscribed, not leaked.
        this.generation += 1;
        const subscriptions = this.subscriptions.splice(0);
        void Promise.all(subscriptions.map((subscription) =>
          subscription.unsubscribe(),
        )).catch((error: unknown) => this.reportError(error));
      },
    };
  }

  private async start(generation: number, handler: WatchObservationHandler): Promise<void> {
    const targets = this.watchTargets();
    await Promise.all(targets.map((target) =>
      this.subscribeTarget(generation, target, handler),
    ));
  }

  private async subscribeTarget(
    generation: number,
    target: WatchTarget,
    handler: WatchObservationHandler,
  ): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    // @parcel/watcher rejects on a missing directory, unlike `node:fs.watch`.
    // Skip non-existent roots so one missing target cannot drop the others.
    // Note: a root missing at subscribe time is never watched until the next
    // subscribe; there is no parent-dir watcher to catch a later `mkdir`.
    if (!(await isDirectory(target.rootPath))) {
      return;
    }

    let subscription: ParcelWatcher.AsyncSubscription;
    try {
      subscription = await this.subscribeFn(
        target.rootPath,
        (error, events) => {
          if (error) {
            this.reportError(error);
            return;
          }
          const observedAtMs = this.options.now?.() ?? Date.now();
          for (const event of events) {
            this.delivery = this.delivery
              .then(() => this.deliver(generation, target, event, observedAtMs, handler))
              .catch((deliveryError: unknown) => this.reportError(deliveryError));
          }
        },
      );
    } catch (error) {
      this.reportError(error);
      return;
    }

    if (generation !== this.generation) {
      await subscription.unsubscribe().catch(() => undefined);
      return;
    }
    this.subscriptions.push(subscription);
  }

  private async deliver(
    generation: number,
    target: WatchTarget,
    event: ParcelWatcher.Event,
    observedAtMs: number,
    handler: WatchObservationHandler,
  ): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    const observation = toObservation(target, event.path, event.type, observedAtMs);
    if (!observation) {
      return;
    }
    await handler(observation);
  }

  private watchTargets(): WatchTarget[] {
    const targets: WatchTarget[] = [];
    for (const root of this.options.roots) {
      targets.push({ domain: 'source', rootPath: uriPath(root.sourceRootUri) });
      targets.push({ domain: 'cognition', rootPath: uriPath(root.cognitionRootUri) });
      targets.push({ domain: 'config', rootPath: path.dirname(uriPath(root.configUri)) });
    }
    return targets;
  }

  private reportError(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    this.options.onError?.(normalized);
  }
}

function toObservation(
  target: WatchTarget,
  changedPath: string,
  eventType: ParcelWatcher.EventType,
  observedAtMs: number,
): WatchObservation | undefined {
  if (target.domain === 'config' && path.basename(changedPath) !== 'config.yaml') {
    return undefined;
  }

  return {
    domain: target.domain,
    uri: pathToUriComponents(changedPath),
    kind: changeKind(eventType),
    observedAtMs,
  };
}

function changeKind(eventType: ParcelWatcher.EventType): WatchFileChangeKind {
  switch (eventType) {
    case 'create':
      return 'create';
    case 'delete':
      return 'delete';
    default:
      return 'change';
  }
}

function uriPath(uri: UriComponents): string {
  return uriComponentsToPath(uri);
}

async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await nodeFs.stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}
