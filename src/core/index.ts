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
export type {
  NormalizedWatchEvent,
  WatchBatchRefreshMode,
  WatchRefreshRoute,
  WatcherEventApplyResult,
  WatchEventDomain,
  WatchFileChangeKind,
  WatchRefreshMode,
} from './watchPipeline';
export {
  ADD_OPERATION_ERROR_CODES,
  addOperation,
  reviewUnchangedOperation,
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
  ReviewUnchangedErrorCode,
  ReviewUnchangedOperationError,
  ReviewUnchangedOperationResult,
  CoggitHandbookCatalogEntry,
  CoggitOperationAction,
  CoggitOperationIssue,
  CoggitProjectContext,
  RoutesOperationResult,
  SnapshotOperationResult,
  SnapshotOperationScope,
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
  ObservedStatus,
  OrphanedCognitionEntry,
  StrayCognitionEntry,
} from './types';
export { discoverWorkspaceRoots, readWorkspaceRoot } from './workspace';

import type { CoggitSnapshot } from './types';
import type { ConfigProvider, FileSystem } from './interfaces';
import { createCoggitServices, discoverCoggitProjects, buildSnapshotFromProjects } from './project';

export async function buildSnapshot(
  fs: FileSystem,
  config: ConfigProvider,
): Promise<CoggitSnapshot> {
  const services = createCoggitServices(fs, config);
  const projects = await discoverCoggitProjects(services);
  return buildSnapshotFromProjects(projects);
}
