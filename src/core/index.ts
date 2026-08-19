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
} from './statusAgentPresentation';
export type {
  StatusAgentActionLegendEntry,
  StatusAgentActionRole,
  StatusAgentIssueLegendEntry,
  StatusAgentIssueRow,
  StatusAgentPresentation,
  StatusAgentSeverityLevel,
} from './statusAgentPresentation';
export {
  projectStatusMissPresentation,
  projectStatusPresentation,
  renderStatusPresentation,
} from './statusPresentation';
export type {
  StatusMissPresentation,
  StatusPresentationFormat,
  StatusPresentationIssue,
  StatusPresentationView,
} from './statusPresentation';
export { projectStatusTriage } from './statusTriage';
export type {
  StatusTriageEntry,
  StatusTriageView,
} from './statusTriage';
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
  LocatedStatusIssue,
  MisplacedCognitionEntry,
  NodeStatusResult,
  NodeStatusTriageEntry,
  ObservedStatus,
  OrphanedCognitionEntry,
  StatusIssueVisibility,
  StrayCognitionEntry,
} from './types';
export { discoverWorkspaceRoots, readWorkspaceRoot } from './workspace';
export { buildSnapshot } from './buildSnapshot';
