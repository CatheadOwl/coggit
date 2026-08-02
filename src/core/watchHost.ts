import type { CoggitProject, UriComponents } from './interfaces';
import type { AffectedResult, CoggitSnapshot } from './types';
import { isEqualOrChildUri, uriKey } from './uri-utils';
import {
  applyWatchEventToProjects,
  planWatchRefresh,
  type NormalizedWatchEvent,
  type WatchBatchRefreshMode,
  type WatchEventDomain,
  type WatchFileChangeKind,
  type WatcherEventApplyResult,
} from './watchPipeline';

export interface WatchObservation {
  readonly domain: WatchEventDomain;
  readonly uri: UriComponents;
  readonly kind: WatchFileChangeKind;
  readonly observedAtMs?: number;
}

export type WatchObservationHandler = (
  observation: WatchObservation,
) => Promise<WatchHostObservationResult>;

export interface WatchObserverSubscription {
  dispose(): void;
}

export interface WatchObserver {
  subscribe(handler: WatchObservationHandler): WatchObserverSubscription;
}

export interface WatchHostOptions {
  readonly projects: readonly CoggitProject[];
  readonly snapshotProvider: () => CoggitSnapshot | Promise<CoggitSnapshot>;
  readonly observer?: WatchObserver;
  readonly now?: () => number;
}

export interface WatchHost {
  start(): void;
  stop(): void;
  observe(observation: WatchObservation): Promise<WatchHostObservationResult>;
}

export interface WatchHostRefreshIntent {
  readonly mode: WatchBatchRefreshMode;
  readonly reason:
    | 'affected-pairs'
    | 'known-root-unmapped'
    | 'outside-known-roots'
    | 'empty-batch'
    | 'structural-event'
    | 'config-event';
  readonly changedPaths: readonly string[];
  readonly affected?: AffectedResult;
}

export interface WatchHostObservationResult {
  readonly observation: WatchObservation;
  readonly generation: number;
  readonly delivered: true;
  readonly matchedRootIds: readonly string[];
  readonly matchedProjectCount: number;
  readonly normalizedEvent?: NormalizedWatchEvent;
  readonly applyResult?: WatcherEventApplyResult;
  readonly refresh: WatchHostRefreshIntent;
}

export function createWatchHost(options: WatchHostOptions): WatchHost {
  let generation = 0;
  let subscription: WatchObserverSubscription | undefined;

  return {
    start() {
      if (subscription || !options.observer) {
        return;
      }
      subscription = options.observer.subscribe((observation) => this.observe(observation));
    },
    stop() {
      subscription?.dispose();
      subscription = undefined;
    },
    async observe(observation) {
      const eventGeneration = ++generation;
      const matchedProjects = matchProjects(options.projects, observation);
      const matchedRootIds = matchedProjects.map((project) => project.root.id);
      const changedPaths = [uriKey(observation.uri)];

      if (matchedProjects.length === 0) {
        return {
          observation,
          generation: eventGeneration,
          delivered: true,
          matchedRootIds,
          matchedProjectCount: 0,
          refresh: {
            mode: 'none',
            reason: 'outside-known-roots',
            changedPaths,
          },
        };
      }

      if (observation.domain === 'config') {
        return {
          observation,
          generation: eventGeneration,
          delivered: true,
          matchedRootIds,
          matchedProjectCount: matchedProjects.length,
          normalizedEvent: normalizeObservation(observation, eventGeneration, options.now),
          refresh: {
            mode: 'full',
            reason: 'config-event',
            changedPaths,
          },
        };
      }

      const normalizedEvent = normalizeObservation(observation, eventGeneration, options.now);
      const applyResult = await applyWatchEventToProjects(matchedProjects, normalizedEvent);

      if (observation.kind !== 'change') {
        return {
          observation,
          generation: eventGeneration,
          delivered: true,
          matchedRootIds,
          matchedProjectCount: matchedProjects.length,
          normalizedEvent,
          applyResult,
          refresh: {
            mode: 'full',
            reason: 'structural-event',
            changedPaths,
          },
        };
      }

      const route = planWatchRefresh(await options.snapshotProvider(), [observation.uri]);
      return {
        observation,
        generation: eventGeneration,
        delivered: true,
        matchedRootIds,
        matchedProjectCount: matchedProjects.length,
        normalizedEvent,
        applyResult,
        refresh: {
          mode: route.mode,
          reason: route.reason,
          changedPaths: route.changedPaths,
          affected: route.affected,
        },
      };
    },
  };
}

function normalizeObservation(
  observation: WatchObservation,
  generation: number,
  now: (() => number) | undefined,
): NormalizedWatchEvent {
  return {
    ...observation,
    generation,
    observedAtMs: observation.observedAtMs ?? now?.(),
  };
}

function matchProjects(
  projects: readonly CoggitProject[],
  observation: WatchObservation,
): CoggitProject[] {
  return projects.filter((project) => {
    if (observation.domain === 'source') {
      return isEqualOrChildUri(project.root.sourceRootUri, observation.uri);
    }
    if (observation.domain === 'cognition') {
      return isEqualOrChildUri(project.root.cognitionRootUri, observation.uri);
    }
    return uriKey(project.root.configUri) === uriKey(observation.uri);
  });
}
