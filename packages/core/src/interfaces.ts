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
  CognitionRoutes,
  AcceptedPair,
  MaintenanceDiagnostic,
  MisplacedCognitionEntry,
  OrphanedCognitionEntry,
  StrayCognitionEntry,
  UnboundCognitionEntry,
  RegistryProvider,
} from './types';
import type { BuildCognitionRoutesOptions } from './cognitionRoutes';
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

// Core service boundary. Adapters own lifecycle/presentation; core owns project semantics.
export interface CoggitServices {
  readonly fs: FileSystem;
  readonly config: ConfigProvider;
  readonly registry?: RegistryProviderFactory;
  readonly logger?: CoggitLogger;
  readonly locks?: ProjectLockManager;
}

/**
 * Result of resolving a source path against a project's source tree.
 * A shared resolution contract so status, snapshot, and routes can surface
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
  buildCognitionRoutes(options?: BuildCognitionRoutesOptions): Promise<CognitionRoutes>;
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
