import type { StatusOperationResult } from '../operations';

/**
 * Hit payload for `tryGetCognitionPath`: the existing paired cognition path and
 * whether that cognition is stale.
 */
export interface CognitionLookupHit {
  cognitionPath: string;
  stale: boolean;
}

/**
 * Project a `statusOperation` result down to the lookup question: does this
 * source path have an existing paired cognition file, and where is it?
 *
 * Returns `null` when there is no existing paired cognition — a source miss, a
 * matched node with no cognition yet, and a not-applicable node all collapse to
 * `null`. On a hit, `stale` is `true` only when the node's own cognition is
 * stale; `conflict` and descendant status do not set it.
 *
 * This is a pure projection over `StatusOperationResult`: it re-encodes fields
 * `statusOperation` already computed and performs no path resolution, path
 * mapping, or presence detection of its own.
 */
export function tryGetCognitionPath(
  statusResult: StatusOperationResult,
): CognitionLookupHit | null {
  if (!statusResult.found) {
    return null;
  }

  const inspection = statusResult.inspection;
  if (!inspection || inspection.cognitionPresence !== 'present') {
    return null;
  }

  // Defensive: `present` implies the node has a cognition URI, so this branch
  // should not fire in practice.
  const cognitionPath = statusResult.cognitionPath;
  if (cognitionPath === null) {
    return null;
  }

  return {
    cognitionPath,
    stale: inspection.ownStatus === 'stale',
  };
}
