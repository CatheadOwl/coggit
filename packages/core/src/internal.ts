export { initProject } from './init';
export { findProjectRoot } from './discover';
export {
  RuntimeAcceptanceEvidence,
  createCoggitServices,
  discoverCoggitProjects,
  openCoggitProject,
  buildSnapshotFromProjects,
} from './project';
export { projectContextFromRoot } from './projectContext';
export {
  noOpProjectLockManager,
  ProjectLockError,
} from './locks';
export { calculateAffected } from './affected';
export {
  applyWatchEventToProjects,
  planWatchRefresh,
  selectWatchRefreshMode,
} from './watchPipeline';
export {
  createWatchHost,
} from './watchHost';
export type {
  NormalizedWatchEvent,
  WatchBatchRefreshMode,
  WatchRefreshRoute,
  WatcherEventApplyResult,
  WatchEventDomain,
  WatchFileChangeKind,
  WatchRefreshMode,
} from './watchPipeline';
export type {
  WatchHost,
  WatchHostObservationResult,
  WatchHostOptions,
  WatchHostRefreshIntent,
  WatchObservation,
  WatchObservationHandler,
  WatchObserver,
  WatchObserverSubscription,
} from './watchHost';
export {
  ADD_OPERATION_ERROR_CODES,
  CORE_OPERATION_IDS,
  addOperation,
  resolveOperation,
  routesOperation,
  findProjectNode,
  handbookCatalog,
  handbookIdForCognitionKind,
  handbookIdForNodeKind,
  operationIssue,
  projectContext,
  snapshotOperation,
  statusOperation,
} from './operations';
export type {
  AddOperationError,
  AddOperationErrorCode,
  AddOperationResult,
  ResolveErrorCode,
  ResolveOperationError,
  ResolveOperationResult,
  CoggitHandbookCatalogEntry,
  CoggitOperationAction,
  CoggitOperationIssue,
  CoggitProjectContext,
  CoreOperationId,
  RoutesOperationResult,
  SnapshotOperationResult,
  SnapshotOperationOptions,
  SnapshotOperationScope,
  SourcePathCandidatesExpander,
  StatusOperationOptions,
  StatusOperationResult,
} from './operations';
export type {
  CoggitProjectDiscoveryOptions,
  RegistryInitFailurePolicy,
} from './project';
export { getCognitionHandbook, getCognitionTemplate } from './cognition';
export { getCoggitSystemPrompt, MINIMAL_SYSTEM_PROMPT } from './systemPrompt';
export type { CoggitSystemPrompt, CoggitSystemPromptKind } from './systemPrompt';
export {
  applyTreeDepth,
  projectSnapshotTree,
  projectTreeFromSnapshot,
} from './projection';
export {
  DEFAULT_ROUTES_DEPTH,
  assembleRoutesContent,
  countRouteNodes,
  flattenRoutesProjection,
  projectRoutesEntries,
  routeProjectionLineText,
  selectRoutesBySourcePath,
  toRoutesStructuredOutput,
} from './routesProjection';
export type {
  AssembleRoutesContentOptions,
  RoutesPresentationContent,
  RoutesPresentationFormat,
  RoutesStructuredOutput,
} from './routesProjection';
export {
  buildMappingIndex,
} from './snapshot';
export {
  detectMisplacedCognitionEntries,
  detectOrphanedCognitionEntries,
  detectStrayCognitionEntries,
  detectUnboundCognitionEntries,
} from './maintenance';
export {
  describeObservedStatus,
  aggregateNodeStatus,
  collectSubtreeIssues,
  computeRuntimeStatus,
  countSubtreeIssues,
  inspectNodeStatus,
  projectStatusIssues,
  projectStatusResultToNodeStatus,
  querySubtreeIssues,
  summarizeRepresentativeMtime,
} from './status';
export {
  projectStatusAgentPresentation,
  renderStatusAgentInspectionText,
  renderStatusAgentPresentation,
} from './status/statusAgentPresentation';
export type {
  StatusAgentActionLegendEntry,
  StatusAgentActionRole,
  StatusAgentIssueLegendEntry,
  StatusAgentIssueRow,
  StatusAgentPresentation,
  StatusAgentSeverityLevel,
} from './status/statusAgentPresentation';
export {
  projectStatusMissPresentation,
  projectStatusPresentation,
  renderStatusPresentation,
} from './status/statusPresentation';
export type {
  StatusMissPresentation,
  StatusPresentationFormat,
  StatusPresentationIssue,
  StatusPresentationView,
} from './status/statusPresentation';
export {
  projectMaintenancePresentation,
  renderMaintenancePresentation,
} from './maintenancePresentation';
export type {
  MaintenanceIssueCode,
  MaintenancePresentationFormat,
  MaintenancePresentationItem,
  MaintenancePresentationView,
} from './maintenancePresentation';
export { projectStatusTriage } from './status/statusTriage';
export type {
  StatusTriageEntry,
  StatusTriageView,
} from './status/statusTriage';
export {
  normalizeSourcePathInput,
  toCognitionFileUri,
  toCognitionFolderReadmeUri,
  toRelativeUriPath,
} from './mapping';
export {
  PATH_HINT_MESSAGE,
  PATH_MISS_MESSAGE,
  pathHintsTryText,
  pathMissMessage,
  renderPathMissText,
  suggestPathHints,
} from './pathHints';
export type {
  SourcePathResolution,
} from './interfaces';
export {
  externalPathFromString,
  uriRelativePath,
} from './uri-utils';
export {
  createEnvCoggitLogger,
  debugLog,
  errorLog,
  infoLog,
  logEvent,
  nullCoggitLogger,
  warnLog,
} from './logger';
export type {
  CoggitLogEvent,
  CoggitLogLevel,
  CoggitLogger,
} from './logger';
export type {
  AddCognitionKind,
  AddCognitionOptions,
  AddCognitionResult,
  CognitionHandbook,
  CognitionKind,
  CognitionTemplate,
} from './cognition';
export type {
  ProjectLockContext,
  ProjectLockManager,
} from './locks';
export type {
  CoggitSnapshot,
  CoggitTreeNode,
  CoggitWorkspaceRoot,
  CognitionDiscoveryEntry,
  LocatedStatusIssue,
  MaintenanceDiagnostic,
  MisplacedCognitionEntry,
  NodeStatusResult,
  NodeStatusTriageEntry,
  ObservedStatus,
  OrphanedCognitionEntry,
  SourceCandidateState,
  StatusIssueVisibility,
  StrayCognitionEntry,
  UnboundCognitionEntry,
} from './types';
export { discoverWorkspaceRoots, readWorkspaceRoot } from './workspace';
export { buildSnapshot } from './buildSnapshot';

// ─── Internal-only surface (monorepo consumers via `@coggit/core/internal`) ───
// These symbols are deliberately absent from `public.ts`: they are either
// adapter/CLI-private (watch lease, registry implementation, gitignore rules,
// source-structure ignore) or shared internal helpers not part of the stable
// SDK contract.

export { formatTimestamp, latestAcceptedTime } from './time';
export {
  REGISTRY_MAINTENANCE_NOTICE,
  REGISTRY_SCHEMA_VERSION,
  Registry,
  RegistryRevisionMismatchError,
  computeRegistryRevision,
  type RegistryCreateOptions,
  type RegistryRevision,
} from './registry/index';
export { InMemoryRegistryProvider } from './registry/inMemoryRegistryProvider';
export {
  GENERATED_SOURCE_STRUCTURE_DIRECTORY_NAMES,
  generatedSourceStructureGlobExclude,
  generatedSourceStructureGlobExcludePatterns,
  isIgnoredSourceStructureEntry,
} from './sourceStructureIgnore';
export {
  isIgnoredByGitignoreRules,
  loadGitignoreRules,
  type CoggitIgnoreRuleSet,
  type FileReader,
  __testing__ as gitignoreTesting,
} from './gitignore';
export { __testing__ as statusTesting } from './status';
export { RESOLVE_ERROR_CODES } from './operations';
export {
  applyRoutesFilters,
  suggestRoutePathHints,
} from './routesProjection';
export { joinUriPath } from './uri-utils';
export {
  WatchLeaseError,
  noOpWatchLeaseManager,
  type WatchLeaseHandle,
  type WatchLeaseManager,
} from './locks';
export type {
  MappingIndex,
  RoutesProjectionNode,
  TreeProjectionNode,
} from './types';
export {
  getParentDir,
  getProjectRootPath,
  inferSourceUriCandidatesFromCognitionUri,
  resolveConfigRoots,
  toCognitionFilePath,
  toCognitionFolderReadmePath,
} from './mapping';
export type {
  EvidenceDiagnostic,
  StatusContext,
  StatusIssue,
} from './status/statusTypes';
export type {
  CoggitConfig,
  CoggitNodeKind,
} from './snapshotTypes';
