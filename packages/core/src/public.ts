/**
 * Public SDK surface for `@coggit/core`.
 *
 * This is the curated barrel exposed through the package `.` export. It
 * intentionally omits the watch family (`calculateAffected`, `applyWatchEventToProjects`,
 * `createWatchHost`, watch types) — v1 is reconcile-on-read and watch authority
 * remains adapter-only — and adds the port contracts runtime adapters must
 * implement against. `internal.ts` stays the full internal barrel (the
 * `@coggit/core/internal` export for in-repo consumers).
 */

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
export { projectStatusTriage } from './statusTriage';
export type {
  StatusTriageEntry,
  StatusTriageView,
} from './statusTriage';
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
  projectStatusResultToNodeStatus,
  querySubtreeIssues,
  summarizeRepresentativeMtime,
} from './status';
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
  CognitionCoveragePresence,
  LocatedStatusIssue,
  MaintenanceDiagnostic,
  MisplacedCognitionEntry,
  NodeStatusInspection,
  NodeStatusResult,
  NodeStatusTriageEntry,
  ObservedStatus,
  OrphanedCognitionEntry,
  SourceCandidateState,
  StrayCognitionEntry,
  UnboundCognitionEntry,
} from './types';
export { discoverWorkspaceRoots, readWorkspaceRoot } from './workspace';
export { buildSnapshot } from './buildSnapshot';

// Port contracts runtime adapters implement against `coggit/core`.
export type {
  UriComponents,
  UriKey,
  FileSystem,
  FileStat,
  WorkspaceFolderInfo,
  ConfigProvider,
  RegistryProviderFactory,
  AcceptanceStore,
  ResolveResult,
  CoggitServices,
  CoggitProject,
  SourcePathResolution,
} from './interfaces';

// Registry + routes DTOs referenced by the ports and facade above.
export type {
  RegistryProvider,
  RegistryFile,
  AcceptedPair,
  CognitionRoutes,
} from './types';
export type { BuildCognitionRoutesOptions } from './cognitionRoutes';
