import * as path from 'node:path';

import {
  buildSnapshotFromProjects,
  openCoggitProject,
  readWorkspaceRoot,
} from '@coggit/core';
import type { CoggitProject, CoggitServices } from '@coggit/core';
import {
  createWatchHost,
  WatchLeaseError,
  type WatchHostObservationResult,
  type WatchObservation,
  type WatchObserver,
  type WatchLeaseHandle,
  type WatchLeaseManager,
} from '@coggit/core/internal';
import { pathToUriComponents, uriComponentsToPath } from '@coggit/runtime-node';
import { createNodeFileWatchObserver, NodeWatchLeaseManager } from '@coggit/runtime-node/internal';
import { UserFacingError } from './status';

export interface WatchCliOptions {
  readonly json?: boolean;
  readonly leaseHeartbeatMs?: number;
  readonly leaseManager?: WatchLeaseManager;
  readonly warn?: (line: string) => void;
}

export interface WatchSession {
  readonly done: Promise<void>;
  dispose(): Promise<void>;
}

const DEFAULT_WATCH_LEASE_HEARTBEAT_MS = 60000;

interface ActiveProjectWatch {
  readonly subscription: { dispose(): void };
  readonly lease: WatchLeaseHandle;
  readonly heartbeat: NodeJS.Timeout;
}

export async function openStrictWatchProject(
  services: CoggitServices,
  targetPath: string = '.',
): Promise<CoggitProject> {
  const resolvedTargetPath = path.resolve(targetPath);
  const projectRootUri = pathToUriComponents(resolvedTargetPath);
  const configUri = pathToUriComponents(path.join(resolvedTargetPath, '.coggit', 'config.yaml'));

  if (!await services.fs.stat(configUri)) {
    throw new UserFacingError(
      `CogGit project is not initialized at ${resolvedTargetPath}. Run "coggit init" first or pass an initialized project root.`,
    );
  }

  const root = await readWorkspaceRoot(
    services.fs,
    {
      uri: projectRootUri,
      name: path.basename(resolvedTargetPath),
      index: 0,
    },
    configUri,
    services.logger,
  );
  if (!root) {
    throw new UserFacingError(`CogGit config is invalid at ${resolvedTargetPath}.`);
  }

  return openCoggitProject(services, root);
}

/**
 * Start continuous observation for the given projects and emit one line per
 * delivered observation.
 *
 * The watcher is adapter-only and stays internal (`@coggit/runtime-node/internal`),
 * outside the `@coggit/runtime-node` v1 surface; the CLI is its first real
 * caller. Each project gets its own observer + host pair so a single project
 * cannot drop the others.
 */
export async function startWatchSession(
  projects: readonly CoggitProject[],
  options: WatchCliOptions = {},
  emit: (line: string) => void = (line) => console.log(line),
  createObserver: (project: CoggitProject) => WatchObserver = defaultCreateObserver,
): Promise<WatchSession> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const leaseManager = options.leaseManager ?? new NodeWatchLeaseManager();
  const heartbeatMs = Math.max(1, options.leaseHeartbeatMs ?? DEFAULT_WATCH_LEASE_HEARTBEAT_MS);
  const warn = options.warn ?? ((line: string) => console.error(line));
  const active = new Set<ActiveProjectWatch>();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const disposeActive = async (entry: ActiveProjectWatch): Promise<void> => {
    if (!active.delete(entry)) {
      return;
    }
    clearInterval(entry.heartbeat);
    try {
      entry.subscription.dispose();
    } finally {
      await entry.lease.release();
    }
    if (active.size === 0) {
      resolveDone();
    }
  };

  try {
    for (const project of projects) {
      const lease = await leaseManager.tryAcquireWatchLease(
        project.root.projectRootUri,
        {
          owner: 'cli',
          operation: 'watch',
          projectLabel: project.root.label,
        },
      );
      if (!lease) {
        warn(`No active watch lease for ${project.root.label}; skipping watcher.`);
        continue;
      }

      try {
        const observer = createObserver(project);
        const host = createWatchHost({
          projects: [project],
          snapshotProvider: () => buildSnapshotFromProjects([project]),
        });
        let entry: ActiveProjectWatch;
        const subscription = observer.subscribe(async (observation: WatchObservation) => {
          const result = await host.observe(observation);
          emit(renderResult(result, options.json ?? false));
          return result;
        });

        entry = {
          subscription,
          lease,
          heartbeat: setInterval(() => {
            void lease.renew().catch((error: unknown) => {
              if (isWatchLeaseReclaimed(error) && entry) {
                void disposeActive(entry);
                return;
              }
              warn(formatWatchLeaseRenewalWarning(project, error));
            });
          }, heartbeatMs),
        };
        active.add(entry);
      } catch (error) {
        await lease.release().catch(() => undefined);
        throw error;
      }
    }

    if (active.size === 0) {
      throw new UserFacingError('No active watch lease available for any discovered project.');
    }
  } catch (error) {
    await Promise.allSettled(Array.from(active, (entry) => disposeActive(entry)));
    throw error;
  }

  return {
    done,
    async dispose() {
      await Promise.all(Array.from(active, (entry) => disposeActive(entry)));
      if (active.size === 0) {
        resolveDone();
      }
    },
  };
}

function isWatchLeaseReclaimed(error: unknown): boolean {
  if (error instanceof WatchLeaseError) {
    return error.code === 'COGGIT_WATCH_LEASE_RECLAIMED';
  }
  return error instanceof Error
    && 'code' in error
    && error.code === 'COGGIT_WATCH_LEASE_RECLAIMED';
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

function formatWatchLeaseRenewalWarning(project: CoggitProject, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return `Watch lease renewal warning for ${project.root.label}: ${reason}`;
}
