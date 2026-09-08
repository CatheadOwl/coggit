import { Registry } from './index';

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

/**
 * Batch application with most-specific-match semantics (closed-set batch
 * relocation design):
 * every relocation is matched against the entry's original (pre-batch)
 * `sourcePath`; when several match, `exact` beats `prefix` and a longer
 * prefix beats a shorter one. Each matched entry is rewritten exactly once,
 * directly to its final destination, so the result is independent of
 * relocation and iteration order. Keys are never re-keyed here — keys are
 * cognition identities re-derived by reconcile once cognition files move.
 *
 * `prefix` matches strict descendants only (`fromSourcePath + '/'`); the
 * moved node itself must be covered by a paired `exact` relocation (the
 * closed-set rule). `fromSourcePath: '.'` matches nothing.
 *
 * A batch containing two relocations with the same `(kind, fromSourcePath)`
 * is an equal-specificity tie and is rejected without mutating the registry.
 */
export function applyRegistrySourceRelocations(
  registry: Registry,
  relocations: readonly RegistrySourceRelocation[],
  source = 'registry-source-relocation',
): boolean {
  assertValidBatch(relocations);

  let updated = false;

  for (const [key, entry] of Object.entries(registry.getAllEntries())) {
    if (entry.sourcePath === null) {
      continue;
    }

    const destination = resolveRelocationDestination(entry.sourcePath, relocations);
    if (destination === undefined || destination === entry.sourcePath) {
      continue;
    }

    registry.setEntry(key, {
      ...entry,
      sourcePath: destination,
    }, source);
    updated = true;
  }

  return updated;
}

function assertValidBatch(relocations: readonly RegistrySourceRelocation[]): void {
  const seen = new Set<string>();
  for (const relocation of relocations) {
    const identity = `${relocation.kind}:${relocation.fromSourcePath}`;
    if (seen.has(identity)) {
      throw new Error(
        `invalid relocation batch: duplicate ${relocation.kind} fromSourcePath '${relocation.fromSourcePath}'`,
      );
    }
    seen.add(identity);
  }
}

function resolveRelocationDestination(
  sourcePath: string,
  relocations: readonly RegistrySourceRelocation[],
): string | undefined {
  let bestFromSourcePath: string | undefined;
  let bestToSourcePath: string | undefined;

  for (const relocation of relocations) {
    if (relocation.fromSourcePath === '.') {
      // Root relocations are unsupported: '.' matches nothing for either kind.
      continue;
    }

    if (relocation.kind === 'exact') {
      // An exact match is the most specific rule possible; equality is unique
      // within a valid batch, so it wins immediately.
      if (sourcePath === relocation.fromSourcePath) {
        return relocation.toSourcePath;
      }
      continue;
    }

    const fromPrefix = relocation.fromSourcePath + '/';
    if (!sourcePath.startsWith(fromPrefix)) {
      continue;
    }

    if (
      bestFromSourcePath === undefined ||
      relocation.fromSourcePath.length > bestFromSourcePath.length
    ) {
      bestFromSourcePath = relocation.fromSourcePath;
      bestToSourcePath = relocation.toSourcePath;
    }
  }

  if (bestFromSourcePath === undefined || bestToSourcePath === undefined) {
    return undefined;
  }

  // The winning prefix relocation moves the ancestor node; the destination
  // keeps the strict-descendant tail (including the separating '/').
  return bestToSourcePath + sourcePath.slice(bestFromSourcePath.length);
}
