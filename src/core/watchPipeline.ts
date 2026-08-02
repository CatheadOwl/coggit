import { calculateAffected } from './affected';
import { buildMappingIndex } from './snapshot';
import type { CoggitProject, UriComponents } from './interfaces';
import type { AffectedResult, CoggitSnapshot } from './types';
import { isEqualOrChildUri, uriKey } from './uri-utils';

export type WatchFileChangeKind = 'change' | 'create' | 'delete';
export type WatchEventDomain = 'source' | 'cognition' | 'config';
export type WatchRefreshMode = 'full' | 'partial';
export type WatchBatchRefreshMode = WatchRefreshMode | 'none';

export interface NormalizedWatchEvent {
  readonly domain: WatchEventDomain;
  readonly uri: UriComponents;
  readonly kind: WatchFileChangeKind;
  readonly generation: number;
  readonly observedAtMs?: number;
}

export interface WatcherEventApplyResult {
  readonly domain: WatchEventDomain;
  readonly kind: WatchFileChangeKind;
  readonly generation: number;
  readonly projectCount: number;
  readonly sourceObservationCount: number;
  readonly directoryObservationCount: number;
  readonly passiveAcceptanceCount: number;
}

export interface WatchRefreshRoute {
  readonly mode: WatchBatchRefreshMode;
  readonly reason: 'affected-pairs' | 'known-root-unmapped' | 'outside-known-roots' | 'empty-batch';
  readonly changedPaths: readonly string[];
  readonly affected: AffectedResult;
}

export function selectWatchRefreshMode(
  kind: WatchFileChangeKind,
  hasMappingIndex: boolean,
): WatchRefreshMode {
  if (kind !== 'change') {
    return 'full';
  }

  return hasMappingIndex ? 'partial' : 'full';
}

export function planWatchRefresh(
  snapshot: CoggitSnapshot,
  changedUris: readonly UriComponents[],
): WatchRefreshRoute {
  const changedPaths = changedUris.map((uri) => uriKey(uri));

  if (changedUris.length === 0) {
    return {
      mode: 'none',
      reason: 'empty-batch',
      changedPaths,
      affected: {
        pairs: [],
        stats: { direct: 0, structural: 0, semantic: 0, total: 0 },
      },
    };
  }

  const mappingIndex = buildMappingIndex(snapshot.allNodes);
  const affected = calculateAffected(changedPaths, mappingIndex);

  if (hasUnmappedChangesUnderKnownRoots(snapshot, changedUris, changedPaths, mappingIndex)) {
    return {
      mode: 'full',
      reason: 'known-root-unmapped',
      changedPaths,
      affected,
    };
  }

  if (affected.pairs.length > 0) {
    return {
      mode: 'partial',
      reason: 'affected-pairs',
      changedPaths,
      affected,
    };
  }

  return {
    mode: 'none',
    reason: 'outside-known-roots',
    changedPaths,
    affected,
  };
}

export async function applyWatchEventToProjects(
  projects: readonly CoggitProject[],
  event: NormalizedWatchEvent,
): Promise<WatcherEventApplyResult> {
  let sourceObservationCount = 0;
  let directoryObservationCount = 0;
  let passiveAcceptanceCount = 0;

  if (event.domain === 'source') {
    const sourceResults = await Promise.all(projects.map((project) =>
      project.recordSourceChange(event.uri, event.generation),
    ));
    sourceObservationCount = countTrue(sourceResults);

    if (event.kind !== 'change') {
      const directoryResults = await Promise.all(projects.map((project) =>
        project.recordDirectoryEntryChange(event.uri, event.generation),
      ));
      directoryObservationCount = countTrue(directoryResults);
    }
  } else if (event.domain === 'cognition') {
    const cognitionResults = await Promise.all(projects.map((project) =>
      project.recordCognitionChange(event.uri, event.generation),
    ));
    passiveAcceptanceCount = countTrue(cognitionResults);
  }

  return {
    domain: event.domain,
    kind: event.kind,
    generation: event.generation,
    projectCount: projects.length,
    sourceObservationCount,
    directoryObservationCount,
    passiveAcceptanceCount,
  };
}

function hasUnmappedChangesUnderKnownRoots(
  snapshot: CoggitSnapshot,
  changedUris: readonly UriComponents[],
  changedPaths: readonly string[],
  mappingIndex: ReturnType<typeof buildMappingIndex>,
): boolean {
  return changedUris.some((uri, index) => {
    if (
      mappingIndex.sourceToCognition.has(changedPaths[index]) ||
      mappingIndex.cognitionToSource.has(changedPaths[index])
    ) {
      return false;
    }

    return snapshot.roots.some((rootNode) =>
      isEqualOrChildUri(rootNode.root.sourceRootUri, uri) ||
      isEqualOrChildUri(rootNode.root.cognitionRootUri, uri),
    );
  });
}

function countTrue(values: readonly boolean[]): number {
  return values.filter(Boolean).length;
}
