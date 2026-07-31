import { Registry } from './index';
import type { PathKeyRecord } from '../types';
import { sourcePathToKey } from '../identity';

export type RegistrySourceRelocation =
  | {
      kind: 'exact';
      fromSourcePath: string;
      toSourcePath: string;
    }
  | {
      kind: 'prefix';
      fromSourcePath: string;
      toSourcePath: string;
    };

export function applyRegistrySourceRelocations(
  registry: Registry,
  relocations: readonly RegistrySourceRelocation[],
  source = 'registry-source-relocation',
): boolean {
  let updated = false;

  for (const relocation of relocations) {
    updated = applyRegistrySourceRelocation(registry, relocation, source) || updated;
  }

  return updated;
}

function applyRegistrySourceRelocation(
  registry: Registry,
  relocation: RegistrySourceRelocation,
  source: string,
): boolean {
  let updated = false;

  for (const [key, entry] of Object.entries(registry.getAllEntries())) {
    if (entry.sourcePath === null) {
      continue;
    }

    const nextSourcePath = relocateSourcePath(entry.sourcePath, relocation);
    if (nextSourcePath === undefined || nextSourcePath === entry.sourcePath) {
      continue;
    }

    registry.setEntry(key, {
      ...entry,
      sourcePath: nextSourcePath,
    }, source);
    updated = true;
  }

  return updated;
}

function relocateSourcePath(
  sourcePath: string,
  relocation: RegistrySourceRelocation,
): string | undefined {
  if (sourcePath === relocation.fromSourcePath) {
    return relocation.toSourcePath;
  }

  if (relocation.kind !== 'prefix') {
    return undefined;
  }

  const fromPrefix = relocation.fromSourcePath === '.'
    ? ''
    : relocation.fromSourcePath + '/';
  if (fromPrefix.length === 0 || !sourcePath.startsWith(fromPrefix)) {
    return undefined;
  }

  return relocation.toSourcePath + sourcePath.slice(relocation.fromSourcePath.length);
}
