import {
  createExclusionEngine,
  explainScopePath,
  PRESETS,
  type ExclusionEngine,
  type ExclusionIO,
  type ExplanationResult,
  type PresetName,
  type ScopeOptions,
} from '@catheadowl/pathscope';
import type { FileSystem, UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot } from './types';
import { joinUriPath, uriBasename, uriRelativePath, uriToExternalPath } from './uri-utils';

/**
 * Source-tree exclusion over the shared pathscope engine.
 *
 * The walk that builds snapshots, fingerprints, and watcher feeds is
 * coggit's own (async, `FileSystem`/URI-based, incremental) — it cannot ride
 * a filesystem walker. This module bridges coggit's traversal to the
 * pathscope decision core (createExclusionEngine): construction runs the
 * gitignore inherited phase through the workspace `FileSystem`, and the two
 * adjudication hooks mirror the engine contract —
 *
 *   excludes(uri, isDirectory) → false ⇒ descend ⇒ foldDirectory(uri) →
 *   adjudicate the children (excludes(...) / fingerprint filters).
 *
 * Semantic change vs. the retired engines (gitignore.ts +
 * sourceStructureIgnore.ts, 2026-10-24 adjudication): the hardcoded
 * 23-entry list is gone. Cache trees ride the `caches` preset; colliding
 * build/deps names (lib, vendor, build, dist, out, coverage, node_modules)
 * ride the `build`/`deps` presets and are un-excludable by a named gitignore
 * negation (`!lib/`) — source that legitimately lives in those directories
 * is indexable again. Nested repositories descend at any depth (2026-10-30
 * adjudication, decision 0002): coggit's source scope is declaration-driven
 * — the source-root declaration IS the registration — so the engine mounts
 * the scanner alignment face; a `.git` hit is report-not-cut, a nested
 * `.gitignore` is rules, not territory, and `.git` entries themselves keep
 * their `vcs`-preset name exclusion.
 */

/** Preset groups coggit mounts for source-tree exclusion (seam: pathscope exclusion floor). */
export const COGGIT_SOURCE_PRESETS: readonly PresetName[] = ['vcs', 'deps', 'build', 'caches'];

/**
 * Directory names skipped by the config/cognition discovery walks — the
 * mounted preset groups' directory entries, derived from the engine preset
 * table (the retired sourceStructureIgnore name list's replacement).
 */
export const SOURCE_DISCOVERY_SKIP_DIRECTORIES: ReadonlySet<string> = new Set(
  COGGIT_SOURCE_PRESETS.flatMap((name) => PRESETS[name].dirs ?? []),
);

/** VS Code recursive discovery exclude globs over the same preset directories. */
export function sourceDiscoveryExcludeGlobPatterns(): string[] {
  return [...SOURCE_DISCOVERY_SKIP_DIRECTORIES].map((name) => `**/${name}/**`);
}

/** Per-traversal exclusion adjudicator over one workspace root. */
export interface SourceExclusion {
  /** Adjudicate an entry below the source root (directories include the stone probe). */
  excludes(uri: UriComponents, isDirectory: boolean): Promise<boolean>;
  /**
   * Fold a directory's `.gitignore` into the cascade (no-op when absent).
   * Call exactly once per descended directory, before adjudicating its
   * children; the source root's own `.gitignore` is consumed at construction.
   */
  foldDirectory(dirUri: UriComponents): Promise<void>;
}

/**
 * Engine options every coggit adjudication face mounts — the walk hooks and
 * the point-query probe replay the same configuration, so a probe verdict can
 * never drift from what a walk would decide (consistency by construction,
 * one shared constant).
 */
const COGGIT_ENGINE_OPTIONS: ScopeOptions = {
  mountPresets: [...COGGIT_SOURCE_PRESETS],
  excludeDotEntries: false,
  alignment: 'scanner',
};

/**
 * Point-query probe: adjudicate one source-root-relative path against the
 * same engine configuration a walk mounts, returning the verdict plus the
 * hit chain (which preset / which gitignore layer / which stone decided) and
 * the explicit-pierce projection. This is the diagnostics half of the
 * exclusion seam — the "why is this path invisible" answer for status-style
 * queries about paths that never entered an index (nonexistent paths
 * adjudicate hypothetically, exactly the status-query shape).
 *
 * File-scheme roots only: the probe is pathscope's self-contained replay
 * over the node filesystem. Remote/memfs roots return `null` — the
 * engine-level reuse face (IO injection) is a registered additive exit on
 * the pathscope side; until it lands, the probe covers local roots and
 * callers degrade to the plain not-found presentation.
 */
export async function explainSourcePath(
  root: CoggitWorkspaceRoot,
  relPath: string,
): Promise<ExplanationResult | null> {
  if (root.sourceRootUri.scheme !== 'file') {
    return null;
  }
  return explainScopePath(uriToExternalPath(root.sourceRootUri), relPath, COGGIT_ENGINE_OPTIONS);
}

/** The probe's answer shape, re-exported for consumers (operations layer). */
export type SourcePathExplanation = ExplanationResult;

/** POSIX path key for a URI inside the workspace root's universe. */
function dirKeyOf(uri: UriComponents): string {
  return uri.path.replace(/\/+$/, '');
}

/**
 * Build the source-tree exclusion engine for a workspace root. The scan
 * root is the source root; the gitignore inherited phase runs from the
 * enclosing git root (found by probing `.git` upward through `fs`) down to
 * the source root, so a project root `.gitignore` above the source root
 * applies exactly as git would apply it.
 */
export async function createSourceExclusion(
  root: CoggitWorkspaceRoot,
  fs: FileSystem,
): Promise<SourceExclusion> {
  const scheme = root.sourceRootUri.scheme;
  const authority = root.sourceRootUri.authority;
  const toUri = (key: string): UriComponents => ({ scheme, authority, path: key, query: '', fragment: '' });
  const rootKey = dirKeyOf(root.sourceRootUri);

  // Tolerant IO, matching the pathscope node default (existsSync never
  // throws, unreadable .gitignore reads as absent): the inherited-phase
  // find-up probes every ancestor up to the universe's disk root, and some
  // ancestor keys are not expressible in a given runtime's URI universe
  // (win32 drive-root '/' under file URLs) — those probe as absent.
  const io: ExclusionIO = {
    exists: async (dirKey, name) => {
      try {
        return await fs.exists(joinUriPath(toUri(dirKey), ...name.split('/')));
      } catch {
        return false;
      }
    },
    readGitignore: async (dirKey) => {
      try {
        const gitignoreUri = joinUriPath(toUri(dirKey), '.gitignore');
        if (!(await fs.exists(gitignoreUri))) {
          return null;
        }
        return await fs.readFile(gitignoreUri);
      } catch {
        return null;
      }
    },
  };

  // The engine options themselves live in COGGIT_ENGINE_OPTIONS (shared
  // with the point-query probe): excludeDotEntries false (the retired
  // engine's behavior — dot entries are ordinary source here), and the
  // scanner alignment face (2026-10-30, decision 0002) — the source-root
  // declaration is the registration, nested repositories participate
  // (rg/fd family), report-not-cut.
  const engine: ExclusionEngine = await createExclusionEngine(rootKey, COGGIT_ENGINE_OPTIONS, io);

  // Per-stone hit NAMES, never a boolean (engine contract): under the
  // scanner face the core-stone cut is suspended only in the array form —
  // the boolean form truncates unconditionally under every face. The names
  // double as report-not-cut metadata (a `.git` hit names a nested repo).
  const stoneHits = async (dirKey: string): Promise<string[]> => {
    const hits: string[] = [];
    for (const name of engine.stoneNames) {
      if (await io.exists(dirKey, name)) {
        hits.push(name);
      }
    }
    return hits;
  };

  return {
    async excludes(uri: UriComponents, isDirectory: boolean): Promise<boolean> {
      const relative = uriRelativePath(root.sourceRootUri, uri);
      if (relative === undefined || relative === '.') {
        return false;
      }
      const relPath = relative.replace(/\\/g, '/');
      if (!isDirectory) {
        return !engine.admitFile(relPath);
      }
      return engine.excludeDirectory(uriBasename(uri), dirKeyOf(uri), await stoneHits(dirKeyOf(uri)));
    },
    async foldDirectory(dirUri: UriComponents): Promise<void> {
      const key = dirKeyOf(dirUri);
      if (key === rootKey) {
        return;
      }
      engine.foldGitignore(key, await io.readGitignore(key));
    },
  };
}
