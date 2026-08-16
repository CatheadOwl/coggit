import {
  buildSnapshotFromProjects,
  createWatchHost,
  type WatchHostObservationResult,
  type WatchObservation,
  type WatchObserver,
} from '../core';
import type { CoggitProject } from '../core/interfaces';
import { createNodeFileWatchObserver } from '../runtime/node/watch';
import { uriComponentsToPath } from '../runtime/node/uri';
import { UserFacingError } from './status';

export interface WatchCliOptions {
  readonly json?: boolean;
}

export interface WatchSession {
  dispose(): void;
}

/**
 * Start continuous observation for the given projects and emit one line per
 * delivered observation.
 *
 * The watcher is adapter-only and stays a deep import (`runtime/node/watch`),
 * outside the `coggit/runtime-node` v1 surface; the CLI is its first real
 * caller. Each project gets its own observer + host pair so a single project
 * cannot drop the others.
 */
export function startWatchSession(
  projects: readonly CoggitProject[],
  options: WatchCliOptions = {},
  emit: (line: string) => void = (line) => console.log(line),
  createObserver: (project: CoggitProject) => WatchObserver = defaultCreateObserver,
): WatchSession {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const subscriptions = projects.map((project) => {
    const observer = createObserver(project);
    const host = createWatchHost({
      projects: [project],
      snapshotProvider: () => buildSnapshotFromProjects([project]),
    });
    return observer.subscribe(async (observation: WatchObservation) => {
      const result = await host.observe(observation);
      emit(renderResult(result, options.json ?? false));
      return result;
    });
  });

  return {
    dispose() {
      for (const subscription of subscriptions) {
        subscription.dispose();
      }
    },
  };
}

function defaultCreateObserver(project: CoggitProject): WatchObserver {
  return createNodeFileWatchObserver({
    roots: [project.root],
    onError: (error) => console.error(error.message),
  });
}

function renderResult(result: WatchHostObservationResult, json: boolean): string {
  if (json) {
    return JSON.stringify(result);
  }
  const path = uriComponentsToPath(result.observation.uri);
  return `${result.observation.domain} ${result.observation.kind} ${path}`;
}
