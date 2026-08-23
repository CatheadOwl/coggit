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

/** Render the full miss line plus optional hint suggestion lines. */
export function renderPathMissText(result: {
  sourcePath: string | null;
  pathMissMessage?: string;
  pathHintMessage?: string;
  pathHints: readonly string[];
}): string {
  const lines = [result.pathMissMessage ?? pathMissMessage(result.sourcePath ?? '')];
  if (result.pathHintMessage && result.pathHints.length > 0) {
    lines.push(result.pathHintMessage);
    lines.push(pathHintsTryText(result.pathHints));
  }
  return lines.join('\n');
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

  const tail = candidateSegments.slice(-sourceSegments.length);
  if (tail.length !== sourceSegments.length) {
    return false;
  }

  // Tolerate a file extension on the candidate's leaf, but only when the
  // query's leaf is plain (no dot at all). This encodes the intent that a
  // dotless leaf query like `registry` can suggest the source path
  // `src/registry.ts`, while a query that already names an extension
  // (`registry.ts`) or a hidden file (`.gitignore`) must match a leaf named
  // exactly that, never `registry.ts.md` or `.gitignore.bak`.
  const queryLeaf = sourceSegments[sourceSegments.length - 1];
  if (queryLeaf.includes('.')) {
    return tail.join('/') === sourcePath;
  }

  tail[tail.length - 1] = stripLeafExtension(tail[tail.length - 1]);
  return tail.join('/') === sourcePath;
}

/** Strip the trailing file extension from a path segment when present. Hidden
 *  files such as `.gitignore` (a dot at index 0) and all-dot names are left
 *  unchanged, mirroring the `sourcePathToKey` convention in identity.ts. */
function stripLeafExtension(segment: string): string {
  if (/^\.+$/u.test(segment)) {
    return segment;
  }
  const dot = segment.lastIndexOf('.');
  if (dot <= 0) {
    return segment;
  }
  return segment.slice(0, dot);
}
