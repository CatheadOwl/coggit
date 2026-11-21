import type {
  AddCognitionOptions,
  AddCognitionResult,
  CognitionHandbook,
  CognitionKind,
  CognitionTemplate,
} from './cognition';
import type {
  CoggitSnapshot,
  CoggitTreeNode,
  CoggitWorkspaceRoot,
  AcceptedPair,
  MaintenanceDiagnostic,
  MisplacedCognitionEntry,
  OrphanedCognitionEntry,
  StrayCognitionEntry,
  UnboundCognitionEntry,
  RegistryProvider,
} from './types';
import type { CoggitLogger } from './logger';
import type { ProjectLockManager } from './locks';

// URI type that replaces vscode.Uri in core
export interface UriComponents {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;
}

// URI identity key type (string)
export type UriKey = string;

// File system abstraction (replaces workspace.fs)
export interface FileSystem {
  readFile(uri: UriComponents): Promise<string>;
  writeFile(uri: UriComponents, content: string): Promise<void>;
  stat(uri: UriComponents): Promise<FileStat | undefined>;
  readDirectory(uri: UriComponents): Promise<Array<[string, number]>>;
  exists(uri: UriComponents): Promise<boolean>;
  createDirectory(uri: UriComponents): Promise<void>;
  /** Delete a file at the given URI. No-op if the file does not exist. */
  delete(uri: UriComponents): Promise<void>;
}

export interface FileStat {
  isDirectory: boolean;
  mtimeMs: number;
}

// Workspace info abstraction (replaces WorkspaceFolder)
export interface WorkspaceFolderInfo {
  uri: UriComponents;
  name: string;
  index: number;
}

// Config/workspace provider (replaces workspace.workspaceFolders, findFiles)
export interface ConfigProvider {
  getWorkspaceFolders(): WorkspaceFolderInfo[];
  findFiles(pattern: string): Promise<UriComponents[]>;
}

export interface RegistryProviderFactory {
  create(projectRoot: UriComponents): RegistryProvider;
}

export interface AcceptanceStore {
  /** Read the complete accepted source/cognition relationship. */
  getAcceptedPair(rootId: string, sourceKey: string): AcceptedPair | null;
  /** Replace the complete accepted relationship atomically in memory. */
  acceptPair(rootId: string, sourceKey: string, pair: AcceptedPair): void;
  /**
   * Return whether runtime-only ordering evidence proves that the current
   * source identity was observed before the current cognition change.
   */
  hasSourceBeforeCognitionEvidence(
    rootId: string,
    sourceKey: string,
    pair: AcceptedPair,
  ): boolean;
}

/** @deprecated Compatibility surface for pre-v5 test adapters. */
export interface FreshnessEvidenceStore {
  getFreshnessTimes(rootId: string, sourceKey: string): {
    sourceFactMtimeMs: number | null;
    cognitionMtimeMs: number | null;
    verificationTimeMs: number | null;
    sourceFactHash: string | null;
  };
  recordSourceFactTime(rootId: string, sourceKey: string, mtimeMs: number, sourceFactHash?: string | null): void;
  recordCognitionTime(rootId: string, sourceKey: string, mtimeMs: number): void;
  recordExplicitVerification(rootId: string, sourceKey: string): void;
}

export interface ResolveResult {
  sourceKey: string;
  accepted?: AcceptedPair;
  /** @deprecated v4 output field; no longer persisted or used for freshness. */
  verificationTimeMs?: number;
}

/**
 * Answers which directory entries belong to a git-tracked shape, so folder
 * skeleton freshness can ignore scratch trees that git does not track
 * (untracked-and-not-gitignored entries must not flip skeletons stale, and a
 * fresh clone must reproduce the same shape). Hosts without a git index
 * (non-repo worktrees, remote/virtual filesystems) omit this service;
 * snapshot builds then fall back to counting every on-disk entry.
 */
/**
 * Which tracked-shape domain a directory belongs to.
 *
 * - `git`: the directory sits in a repository whose index could be read;
 *   `names` are the tracked direct children and folder source facts
 *   fingerprint only those.
 * - `non-git`: no git index governs this tree (declaration-driven scope,
 *   virtual or non-repository workspaces). Every on-disk entry counts —
 *   the stable fallback semantics, and acceptance flows run as before.
 * - `unavailable`: a git index governs this tree but cannot be read right
 *   now (transient command failure, oversized output). Reads fall back to
 *   counting every entry for display, and acceptance writes for
 *   folder-sourced facts are HELD — bootstrapping, cognition-only and
 *   ordered auto-acceptance, and explicit resolve must not persist a
 *   fingerprint derived from the wrong domain.
 */
export type TrackedShapeDomain =
  | { kind: 'git'; names: Set<string> }
  | { kind: 'non-git' }
  | { kind: 'unavailable' };

export interface TrackedEntriesIndex {
  /**
   * Direct-child names of `directoryUri` that are part of the git-tracked
   * shape, together with the domain that produced the answer.
   */
  trackedChildNames(directoryUri: UriComponents): Promise<TrackedShapeDomain>;
}

// Core service boundary. Adapters own lifecycle/presentation; core owns project semantics.
export interface CoggitServices {
  readonly fs: FileSystem;
  readonly config: ConfigProvider;
  readonly registry?: RegistryProviderFactory;
  readonly logger?: CoggitLogger;
  readonly locks?: ProjectLockManager;
  readonly trackedEntries?: TrackedEntriesIndex;
}

/**
 * Result of resolving a source path against a project's source tree.
 * A shared resolution contract so status and snapshot can surface
 * consistent "you may mean" hints instead of a bare not-found miss.
 */
export interface SourcePathResolution {
  /** The matched node, or undefined when the path matched nothing. */
  node: CoggitTreeNode | undefined;
  /** Source-root-relative path used for matching, after normalization. */
  normalizedPath: string;
  /**
   * Source-root-relative candidate paths available for fuzzy hinting.
   * Present only when node is undefined.
   */
  candidatePaths?: string[];
}

export interface CoggitProject {
  readonly root: CoggitWorkspaceRoot;
  /**
   * Re-validate project registry freshness by scanning cognition state and
   * reconciling under the project write coordination boundary.
   *
   * Idempotent: if nothing changed since the last reconcile, the scan produces
   * no diff and the registry content remains unchanged. Safe to call from
   * multiple concurrent MCP processes — the write lock serializes mutations
   * and the second caller sees an already-fresh registry.
   *
   * Fail-closed: if the lock cannot be acquired, the registry cannot be loaded,
   * or the flush fails, the error propagates to the caller. Callers must handle
   * the failure explicitly rather than silently serving stale state.
   *
   * Callers: MCP read tools before returning authoritative results, CLI reads,
   * VS Code project-open, future watcher triggers.
   */
  ensureFresh(): Promise<void>;
  buildSnapshot(): Promise<CoggitSnapshot>;
  addCognition(sourcePath: string, options?: AddCognitionOptions): Promise<AddCognitionResult>;
  getCognitionHandbook(kind: CognitionKind): CognitionHandbook;
  /**
   * @deprecated Aggregate handbook access is retained only for CLI compatibility.
   * Use 'leaf' or 'skeleton' for maintained guidance.
   */
  getCognitionHandbook(kind?: 'all'): CognitionHandbook;
  getCognitionTemplate(kind: CognitionKind): CognitionTemplate;
  getNode(sourcePath: string): Promise<CoggitTreeNode | undefined>;
  /**
   * Resolve a source path to a snapshot node, reusing one snapshot build.
   * When the path matches nothing, also expose the normalized path and the
   * source tree candidate paths so callers can offer fuzzy path hints.
   */
  resolveSourcePath(sourcePath: string): Promise<SourcePathResolution>;
  listUntracked(): Promise<CoggitTreeNode[]>;
  listOrphanedCognition(): Promise<OrphanedCognitionEntry[]>;
  listMisplacedCognition(): Promise<MisplacedCognitionEntry[]>;
  listStrayCognition(): Promise<StrayCognitionEntry[]>;
  listUnboundCognition(): Promise<UnboundCognitionEntry[]>;
  /**
   * Aggregate maintenance diagnostics from a single core-owned entry point.
   * Runs after project freshness, so registry-backed and scan-backed slices
   * share one reconciled view. The stray slice is a raw/pre-reconcile
   * compatibility view and is expected to be empty in ordinary freshened
   * flows, because reconcile auto-registers source-paired cognition.
   * CI and adapters must consume this surface instead of reinterpreting
   * registry JSON.
   */
  listMaintenanceDiagnostics(): Promise<MaintenanceDiagnostic[]>;
  /**
   * Move a misplaced cognition file to its expected location.
   * Updates both the file system and registry.
   * Returns undefined on success, or an error message string on failure.
   */
  moveCognitionToExpected(entry: MisplacedCognitionEntry): Promise<string | undefined>;
  /**
   * Apply a source file/folder rename to registry sourcePath metadata.
   * Returns true when at least one registry record was updated.
   */
  applySourceRename(oldUri: UriComponents, newUri: UriComponents): Promise<boolean>;
  /**
   * Observe a source-content watcher event without changing durable
   * acceptance. The generation must share the caller's watcher event order.
   * Returns true when runtime ordering evidence was recorded.
   */
  recordSourceChange(uri: UriComponents, generation?: number): Promise<boolean>;
  /**
   * Observe a directory-entry watcher event for the parent folder/root of a
   * changed source URI without changing durable acceptance. Returns true when
   * runtime ordering evidence was recorded.
   */
  recordDirectoryEntryChange(uri: UriComponents, generation?: number): Promise<boolean>;
  /**
   * Observe a cognition watcher event. Returns true when the observation
   * passively accepts the current source/cognition pair.
   */
  recordCognitionChange(uri: UriComponents, generation?: number): Promise<boolean>;
  markResolved(sourcePath: string): Promise<ResolveResult>;
  refreshNode(sourcePath: string): Promise<CoggitTreeNode | undefined>;
  flush(): Promise<void>;
}
