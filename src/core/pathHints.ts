/**
 * Fuzzy source-path hint suggestions, shared by routes, status, and snapshot.
 *
 * When a source path matches nothing, segment-suffix matching suggests the
 * closest existing source paths. A miss like `src/core/watchPipeline.ts` can
 * suggest the source-root-relative path `coggit/src/core/watchPipeline.ts`
 * because their trailing segments match.
 *
 * Hints are suggestions for caller re-decision, never automatic rewrites:
 * the caller chooses whether to re-run against a suggested path.
 */

const HINT_COLLECT_CAP = 5;

/**
 * Collect up to five candidate paths whose trailing segments match the
 * source path. Returns an empty array when nothing matches.
 */
export function suggestPathHints(
  candidatePaths: Iterable<string>,
  sourcePath: string,
): string[] {
  if (sourcePath === '' || sourcePath === '.') {
    return [];
  }

  const hints = new Set<string>();
  for (const candidate of candidatePaths) {
    if (pathHintMatches(candidate, sourcePath)) {
      hints.add(candidate);
      if (hints.size >= HINT_COLLECT_CAP) {
        break;
      }
    }
  }

  return [...hints];
}

/** Shared phrase for a source path that matched no node. */
const PATH_MISS_BASE = 'Path not found in any CogGit project';

/** Canonical bare sentence (no path) for a source path that matched no node. */
export const PATH_MISS_MESSAGE = `${PATH_MISS_BASE}.`;

/** Canonical lead-in for the fuzzy-hint suggestion line. */
export const PATH_HINT_MESSAGE = 'You may mean one of these source-root-relative source paths.';

/** Full miss line including the source path, e.g. `Path not found in any CogGit project: src/main.ts`. */
export function pathMissMessage(sourcePath: string): string {
  return `${PATH_MISS_BASE}: ${sourcePath}`;
}
/** Render the backtick-wrapped hint list: `` `a`, `b` ``. */
export function pathHintsTryText(pathHints: readonly string[]): string {
  return `Try: ${pathHints.map((hint) => `\`${hint}\``).join(', ')}`;
}

function pathHintMatches(candidate: string, sourcePath: string): boolean {
  if (candidate === sourcePath) {
    return false;
  }

  const candidateSegments = candidate.split('/').filter(Boolean);
  const sourceSegments = sourcePath.split('/').filter(Boolean);
  if (sourceSegments.length === 0) {
    return false;
  }

  if (candidate.endsWith(`/${sourcePath}`)) {
    return true;
  }

  return candidateSegments.slice(-sourceSegments.length).join('/') === sourcePath;
}
