import type { CoggitProject, UriComponents } from './interfaces';

export type WatchFileChangeKind = 'change' | 'create' | 'delete';
export type WatchEventDomain = 'source' | 'cognition' | 'config';
export type WatchRefreshMode = 'full' | 'partial';

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
  readonly sourceRecordChangedCount: number;
  readonly directoryRecordChangedCount: number;
  readonly passiveAcceptanceCount: number;
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

export async function applyWatchEventToProjects(
  projects: readonly CoggitProject[],
  event: NormalizedWatchEvent,
): Promise<WatcherEventApplyResult> {
  let sourceRecordChangedCount = 0;
  let directoryRecordChangedCount = 0;
  let passiveAcceptanceCount = 0;

  if (event.domain === 'source') {
    const sourceResults = await Promise.all(projects.map((project) =>
      project.recordSourceChange(event.uri, event.generation),
    ));
    sourceRecordChangedCount = countTrue(sourceResults);

    if (event.kind !== 'change') {
      const directoryResults = await Promise.all(projects.map((project) =>
        project.recordDirectoryEntryChange(event.uri, event.generation),
      ));
      directoryRecordChangedCount = countTrue(directoryResults);
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
    sourceRecordChangedCount,
    directoryRecordChangedCount,
    passiveAcceptanceCount,
  };
}

function countTrue(values: readonly boolean[]): number {
  return values.filter(Boolean).length;
}
