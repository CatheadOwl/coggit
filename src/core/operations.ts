import type { AddCognitionKind, CognitionKind } from './cognition';
import type { CoggitProject, SourcePathResolution } from './interfaces';
import type {
  CoggitSnapshot,
  CoggitTreeNode,
  CoggitNodeKind,
  CoggitOperationAction,
  CoggitProjectContext,
  LocatedStatusIssue,
  NodeStatusInspection,
  ObservedStatus,
  SnapshotOperationScope,
  StaleAction,
  StatusIssue,
  StatusIssueVisibility,
  CognitionRoutes,
  CognitionRoutesEntry,
  CognitionDocumentDiagnostic,
} from './types';
import { buildSnapshotFromProjects } from './project';
import { inspectNodeStatus, querySubtreeIssues } from './status';
import { toRelativeUriPath } from './mapping';
import {
  PATH_HINT_MESSAGE,
  PATH_MISS_MESSAGE,
  pathMissMessage,
  suggestPathHints,
} from './pathHints';
import { projectContext as projectContextFromProject } from './projectContext';

export type {
  CoggitOperationAction,
  CoggitProjectContext,
  CoreOperationId,
  SnapshotOperationScope,
} from './types';

export { CORE_OPERATION_IDS } from './operationTypes';

export interface CoggitHandbookCatalogEntry {
  id: 'all' | CognitionKind;
  nodeKind: CoggitNodeKind | null;
  title: string;
  kind: 'all' | CognitionKind;
}

export interface CoggitOperationIssue {
  relativePath: string;
  severity: 'info' | 'warning' | 'error';
  code: StatusIssue['diagnostic']['code'] | 'path-not-found' | 'add-failed' | 'invalid-kind';
  message: string;
  actions: CoggitOperationAction[];
}

export interface SnapshotOperationResult {
  scope: SnapshotOperationScope;
  projectCount: number;
  trackedCount: number;
  untrackedCount: number;
  issueCount: number;
  nextScopes: SnapshotOperationScope[];
  maxDepth: number | null;
  truncated: boolean;
  omittedChildrenCount: number;
  suggestedActions: CoggitOperationAction[];
  projects: CoggitProjectContext[];
  sourcePath: string | null;
  found: boolean;
  snapshot: CoggitSnapshot | null;
  node: CoggitTreeNode | null;
  /** Fuzzy source-path hints when the source path matched no node. Empty when found. */
  pathHints: string[];
  /** Present only when the source path matched no node. */
  pathMissMessage?: string;
  /** Present only when a miss produced fuzzy hints. */
  pathHintMessage?: string;
}

export interface StatusOperationResult {
  found: boolean;
  sourcePath: string;
  nodeKind: CoggitNodeKind | null;
  project: CoggitProjectContext | null;
  cognitionPath: string | null;
  status: ObservedStatus | null;
  ownStatus: ObservedStatus | null;
  descendantStatus: ObservedStatus | null;
  staleAction: StaleAction | null;
  issueCount: number;
  ownIssueCount: number;
  descendantIssueCount: number;
  issues: CoggitOperationIssue[];
  suggestedActions: CoggitOperationAction[];
  handbookId: 'leaf' | 'skeleton' | null;
  node: CoggitTreeNode | null;
  /** Fuzzy source-path hints when the source path matched no node. Empty when found. */
  pathHints: string[];
  /** Present only when the source path matched no node. */
  pathMissMessage?: string;
  /** Present only when a miss produced fuzzy hints. */
  pathHintMessage?: string;
  /** Canonical status inspection when the node was found.
   *  undefined when found is false. */
  inspection?: NodeStatusInspection | undefined;
}

export const ADD_OPERATION_ERROR_CODES = [
  'no-projects',
  'path-not-found',
  'invalid-kind',
  'mapping-conflict',
  'filesystem-failure',
  'unknown',
] as const;

export type AddOperationErrorCode = typeof ADD_OPERATION_ERROR_CODES[number];

export interface AddOperationError {
  code: AddOperationErrorCode;
  message: string;
}

export interface AddOperationResult {
  success: boolean;
  created: boolean | null;
  kind: CognitionKind | null;
  sourcePath: string;
  cognitionPath: string | null;
  project: CoggitProjectContext | null;
  handbookId: 'leaf' | 'skeleton' | null;
  suggestedActions: CoggitOperationAction[];
  error: AddOperationError | null;
  /** Fuzzy source-path hints when the source path matched no node. Empty when found. */
  pathHints: string[];
  /** Present only when the source path matched no node. */
  pathMissMessage?: string;
  /** Present only when a miss produced fuzzy hints. */
  pathHintMessage?: string;
}

export const RESOLVE_ERROR_CODES = [
  'no-projects',
  'path-not-found',
  'registry-unavailable',
  'registry-changed',
  'content-changed',
  'unknown',
] as const;

export type ResolveErrorCode = typeof RESOLVE_ERROR_CODES[number];

export interface ResolveOperationError {
  code: ResolveErrorCode;
  message: string;
}

export interface ResolveOperationResult {
  success: boolean;
  sourcePath: string;
  cognitionPath: string | null;
  project: CoggitProjectContext | null;
  sourceKey: string | null;
  verificationTimeMs: number | null;
  suggestedActions: CoggitOperationAction[];
  error: ResolveOperationError | null;
  /** Fuzzy source-path hints when the source path matched no node. Empty when found. */
  pathHints: string[];
  /** Present only when the source path matched no node. */
  pathMissMessage?: string;
  /** Present only when a miss produced fuzzy hints. */
  pathHintMessage?: string;
}

export interface RoutesOperationResult {
  project: CoggitProjectContext;
  generatedAt: number;
  entryCount: number;
  entries: CognitionRoutesEntry[];
  diagnostics: CognitionDocumentDiagnostic[];
  routes: CognitionRoutes;
}

export function projectContext(project: CoggitProject): CoggitProjectContext {
  return projectContextFromProject(project);
}

export function handbookCatalog(): CoggitHandbookCatalogEntry[] {
  return [
    { id: 'all', nodeKind: null, title: 'Complete CogGit cognition authoring handbook', kind: 'all' },
    { id: 'leaf', nodeKind: 'file', title: 'CogGit leaf cognition handbook', kind: 'leaf' },
    { id: 'skeleton', nodeKind: 'folder', title: 'CogGit skeleton cognition handbook', kind: 'skeleton' },
  ];
}

export function handbookIdForNodeKind(kind: CoggitNodeKind): 'leaf' | 'skeleton' {
  return kind === 'file' ? 'leaf' : 'skeleton';
}

export function handbookIdForCognitionKind(kind: CognitionKind): 'leaf' | 'skeleton' {
  return kind;
}

export async function findProjectNode(
  projects: readonly CoggitProject[],
  sourcePath: string,
): Promise<{ project: CoggitProject; node: CoggitTreeNode } | undefined> {
  for (const project of projects) {
    const node = await project.getNode(sourcePath);
    if (node) {
      return { project, node };
    }
  }

  return undefined;
}

/** Expand a raw input path into candidate source-root-relative paths to try, per project. */
export type SourcePathCandidatesExpander = (
  project: CoggitProject,
  sourcePath: string,
) => readonly string[];

const identitySourcePathCandidates: SourcePathCandidatesExpander = (_project, sourcePath) => [sourcePath];

/**
 * Shared source-path resolution for operations: resolve the first matching
 * node across candidate input forms (default: the input as-is), or collect
 * fuzzy hints from every project when none match.
 */
async function resolveSourcePathWithHits(
  projects: readonly CoggitProject[],
  sourcePath: string,
  expandCandidates: SourcePathCandidatesExpander = identitySourcePathCandidates,
): Promise<{
  match: { project: CoggitProject; node: CoggitTreeNode } | undefined;
  pathHints: string[];
}> {
  let allCandidates: string[] = [];
  let normalizedPath: string | undefined;
  for (const project of projects) {
    for (const candidate of expandCandidates(project, sourcePath)) {
      const resolution: SourcePathResolution = await project.resolveSourcePath(candidate);
      if (resolution.node) {
        return { match: { project, node: resolution.node }, pathHints: [] };
      }
      if (resolution.candidatePaths) {
        allCandidates.push(...resolution.candidatePaths);
      }
      normalizedPath ??= resolution.normalizedPath;
    }
  }
  return { match: undefined, pathHints: suggestPathHints(allCandidates, normalizedPath ?? sourcePath) };
}

export interface SnapshotOperationOptions {
  sourcePath?: string;
  scope?: SnapshotOperationScope;
  maxDepth?: number;
  sourcePathCandidates?: SourcePathCandidatesExpander;
}

export async function snapshotOperation(
  projects: readonly CoggitProject[],
  options: SnapshotOperationOptions = {},
): Promise<SnapshotOperationResult> {
  const scope = options.scope ?? 'tracked';
  const maxDepth = normalizeMaxDepth(options.maxDepth);
  const projectsContext = projects.map(projectContext);
  const sourcePath = options.sourcePath ?? null;

  if (sourcePath) {
    const { match, pathHints } = await resolveSourcePathWithHits(
      projects,
      sourcePath,
      options.sourcePathCandidates,
    );
    const node = match?.node ?? null;
    const counts = snapshotCounts(node ? flattenNode(node) : []);
    const omittedChildrenCount = node ? countOmittedChildren([node], maxDepth) : 0;
    return {
      ...counts,
      scope,
      projectCount: projects.length,
      maxDepth,
      truncated: omittedChildrenCount > 0,
      omittedChildrenCount,
      suggestedActions: suggestedActionsForSnapshot(counts, {
        sourcePath,
        foundSourcePath: node?.relativePath ?? null,
        maxDepth,
        projectCount: projects.length,
      }),
      projects: match ? [projectContext(match.project)] : projectsContext,
      sourcePath,
      found: match !== undefined,
      snapshot: null,
      node,
      pathHints,
      ...(match ? {} : { pathMissMessage: pathMissMessage(sourcePath) }),
      ...(!match && pathHints.length > 0 ? { pathHintMessage: PATH_HINT_MESSAGE } : {}),
    };
  }

  const snapshot = await buildSnapshotFromProjects(projects);
  const counts = snapshotCounts(snapshot.allNodes);
  const omittedChildrenCount = countOmittedChildren(snapshot.roots, maxDepth);
  return {
    ...counts,
    scope,
    projectCount: projects.length,
    maxDepth,
    truncated: omittedChildrenCount > 0,
    omittedChildrenCount,
    suggestedActions: suggestedActionsForSnapshot(counts, {
      sourcePath: null,
      foundSourcePath: projects.length === 1 ? '.' : null,
      maxDepth,
      projectCount: projects.length,
    }),
    projects: projectsContext,
    sourcePath,
    found: true,
    snapshot,
    node: null,
    pathHints: [],
  };
}

export interface StatusOperationOptions {
  sourcePathCandidates?: SourcePathCandidatesExpander;
  issueVisibility?: StatusIssueVisibility;
}

export async function statusOperation(
  projects: readonly CoggitProject[],
  sourcePath: string,
  options: StatusOperationOptions = {},
): Promise<StatusOperationResult> {
  const { match, pathHints } = await resolveSourcePathWithHits(
    projects,
    sourcePath,
    options.sourcePathCandidates,
  );
  if (!match) {
    return {
      found: false,
      sourcePath,
      nodeKind: null,
      project: null,
      cognitionPath: null,
      status: null,
      ownStatus: null,
      descendantStatus: null,
      staleAction: null,
      issueCount: 1,
      ownIssueCount: 0,
      descendantIssueCount: 0,
      issues: [{
        relativePath: sourcePath,
        severity: 'error',
        code: 'path-not-found',
        message: PATH_MISS_MESSAGE,
        actions: [],
      }],
      suggestedActions: [],
      handbookId: null,
      node: null,
      pathHints,
      pathMissMessage: pathMissMessage(sourcePath),
      ...(pathHints.length > 0 ? { pathHintMessage: PATH_HINT_MESSAGE } : {}),
    };
  }

  const cognitionPath = cognitionRelativePath(match.node);
  const handbookId = handbookIdForNodeKind(match.node.kind);
  const inspection = inspectNodeStatus({
    node: match.node,
    sourcePath: match.node.relativePath,
    cognitionPath,
    handbookId,
    issueVisibility: options.issueVisibility,
  });
  const issues = [
    ...inspection.subtreeIssues.own,
    ...inspection.subtreeIssues.descendant,
  ].map(operationIssue);

  return {
    found: true,
    sourcePath: match.node.relativePath,
    nodeKind: match.node.kind,
    project: projectContext(match.project),
    cognitionPath,
    status: inspection.status,
    ownStatus: inspection.ownStatus,
    descendantStatus: inspection.descendantStatus,
    staleAction: match.node.status?.staleAction ?? null,
    issueCount: inspection.issueSummary.total,
    ownIssueCount: inspection.issueSummary.own,
    descendantIssueCount: inspection.issueSummary.descendant,
    issues,
    suggestedActions: inspection.suggestedActions,
    handbookId,
    node: match.node,
    inspection,
    pathHints: [],
  };
}

export async function addOperation(
  projects: readonly CoggitProject[],
  sourcePath: string,
  options: { kind?: AddCognitionKind; overwrite?: boolean; sourcePathCandidates?: SourcePathCandidatesExpander } = {},
): Promise<AddOperationResult> {
  if (projects.length === 0) {
    return addFailure(sourcePath, null, [recheckStatusAction(sourcePath)], 'no-projects', 'No CogGit project found.');
  }

  const { match, pathHints } = await resolveSourcePathWithHits(
    projects,
    sourcePath,
    options.sourcePathCandidates,
  );
  if (!match) {
    return addFailure(sourcePath, null, [], 'path-not-found', PATH_MISS_MESSAGE, {
      pathHints,
      pathMissMessage: pathMissMessage(sourcePath),
      pathHintMessage: pathHints.length > 0 ? PATH_HINT_MESSAGE : undefined,
    });
  }

  try {
    const result = await match.project.addCognition(match.node.relativePath, {
      kind: options.kind ?? 'auto',
      overwrite: options.overwrite ?? false,
    });
    const sourcePath = match.node.relativePath;
    const cognitionPath = toRelativeUriPath(match.project.root.cognitionRootUri, result.cognitionUri);
    return {
      success: true,
      created: result.created,
      kind: result.kind,
      sourcePath,
      cognitionPath,
      project: projectContext(match.project),
      handbookId: handbookIdForCognitionKind(result.kind),
      suggestedActions: [],
      error: null,
      pathHints: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = classifyAddError(message);
    return addFailure(
      match.node.relativePath,
      projectContext(match.project),
      [recheckStatusAction(match.node.relativePath)],
      code,
      message,
    );
  }
}

export async function resolveOperation(
  projects: readonly CoggitProject[],
  sourcePath: string,
  options: { sourcePathCandidates?: SourcePathCandidatesExpander } = {},
): Promise<ResolveOperationResult> {
  if (projects.length === 0) {
    return resolveFailure(sourcePath, null, null, [recheckStatusAction(sourcePath)], 'no-projects', 'No CogGit project found.');
  }

  const expandCandidates = options.sourcePathCandidates ?? identitySourcePathCandidates;
  let sawPathNotFound = false;
  for (const candidate of projects) {
    for (const candidatePath of expandCandidates(candidate, sourcePath)) {
      try {
        // Do not call getNode before the acceptance operation: building a
        // snapshot can bootstrap an unaccepted cognition pair, which would
        // leave a partial acceptance if the final reread then fails.
        const result = await candidate.markResolved(candidatePath);
        const node = await candidate.getNode(candidatePath);
        const matchedSourcePath = node?.relativePath ?? candidatePath;
        return {
          success: true,
          sourcePath: matchedSourcePath,
          cognitionPath: node ? cognitionRelativePath(node) : null,
          project: projectContext(candidate),
          sourceKey: result.sourceKey,
          verificationTimeMs: result.verificationTimeMs ?? null,
          suggestedActions: [],
          error: null,
          pathHints: [],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Path not found')) {
          sawPathNotFound = true;
          continue;
        }
        const code = message.includes('Registry not available')
          ? 'registry-unavailable'
          : message.includes('Registry changed during resolve')
            ? 'registry-changed'
            : message.includes('changed during resolve')
              ? 'content-changed'
              : 'unknown';
        return resolveFailure(
          sourcePath,
          null,
          projectContext(candidate),
          [recheckStatusAction(sourcePath)],
          code,
          message,
          { pathHints: [] },
        );
      }
    }
  }

  const { pathHints } = await resolveSourcePathWithHits(projects, sourcePath, expandCandidates);
  const miss = sawPathNotFound;
  return resolveFailure(
    sourcePath,
    null,
    null,
    miss ? [] : [recheckStatusAction(sourcePath)],
    miss ? 'path-not-found' : 'unknown',
    PATH_MISS_MESSAGE,
    {
      pathHints,
      pathMissMessage: pathMissMessage(sourcePath),
      pathHintMessage: pathHints.length > 0 ? PATH_HINT_MESSAGE : undefined,
    },
  );
}

export async function routesOperation(
  project: CoggitProject,
  options: Parameters<CoggitProject['buildCognitionRoutes']>[0] = {},
): Promise<RoutesOperationResult> {
  const routes = await project.buildCognitionRoutes(options);
  return {
    project: routes.project,
    generatedAt: routes.generatedAt,
    entryCount: routes.entries.length,
    entries: routes.entries,
    diagnostics: routes.diagnostics,
    routes,
  };
}

function flattenNode(node: CoggitTreeNode): CoggitTreeNode[] {
  return [
    node,
    ...(node.children ?? []).flatMap(flattenNode),
  ];
}

function snapshotCounts(nodes: readonly CoggitTreeNode[]): Pick<
  SnapshotOperationResult,
  'trackedCount' | 'untrackedCount' | 'issueCount' | 'nextScopes'
> {
  let trackedCount = 0;
  let untrackedCount = 0;
  let issueCount = 0;

  for (const node of nodes) {
    if (node.ownStatus?.coverage?.ownCognition === 'present') {
      trackedCount++;
    }
    if (
      node.ownStatus?.coverage?.ownCognition === 'missing'
      && node.ownStatus.coverage.isMaterializable
    ) {
      untrackedCount++;
    }
    issueCount += querySubtreeIssues(node).ownIssues.length;
  }

  const nextScopes: SnapshotOperationScope[] = [];
  if (untrackedCount > 0) {
    nextScopes.push('untracked');
  }
  if (issueCount > 0) {
    nextScopes.push('issues');
  }
  if (trackedCount === 0 && nodes.length > 0) {
    nextScopes.push('all');
  }

  return { trackedCount, untrackedCount, issueCount, nextScopes };
}

function normalizeMaxDepth(maxDepth: number | undefined): number | null {
  return maxDepth !== undefined && Number.isInteger(maxDepth) && maxDepth >= 0
    ? maxDepth
    : null;
}

function countOmittedChildren(nodes: readonly CoggitTreeNode[], maxDepth: number | null): number {
  if (maxDepth === null) {
    return 0;
  }

  return nodes.reduce((total, node) => total + countNodeOmittedChildren(node, 0, maxDepth), 0);
}

function countNodeOmittedChildren(node: CoggitTreeNode, depth: number, maxDepth: number): number {
  const children = node.children ?? [];
  if (depth >= maxDepth) {
    return children.length;
  }

  return children.reduce(
    (total, child) => total + countNodeOmittedChildren(child, depth + 1, maxDepth),
    0,
  );
}

function suggestedActionsForSnapshot(
  counts: Pick<SnapshotOperationResult, 'untrackedCount' | 'issueCount'>,
  context: {
    sourcePath: string | null;
    foundSourcePath: string | null;
    maxDepth: number | null;
    projectCount: number;
  },
): CoggitOperationAction[] {
  const actions: CoggitOperationAction[] = [];
  const snapshotActionBase = {
    operation: 'snapshot' as const,
    ...(context.sourcePath !== null ? { sourcePath: context.sourcePath } : {}),
    ...(context.maxDepth !== null ? { maxDepth: context.maxDepth } : {}),
  };

  if (counts.untrackedCount > 0) {
    actions.push({
      code: 'inspect-untracked',
      label: 'Inspect source paths missing paired cognition.',
      ...snapshotActionBase,
      scope: 'untracked',
    });
  }

  if (counts.issueCount > 0) {
    actions.push({
      code: 'inspect-issues',
      label: 'Inspect cognition maintenance issues.',
      ...snapshotActionBase,
      scope: 'issues',
    });
  }

  if (context.foundSourcePath && (context.sourcePath !== null || context.projectCount === 1)) {
    actions.push({
      code: 'diagnose-source-path',
      label: 'Diagnose this source path before explaining or editing it.',
      operation: 'status',
      sourcePath: context.foundSourcePath,
    });
  }

  return uniqueActions(actions);
}

export function operationIssue(located: LocatedStatusIssue): CoggitOperationIssue {
  return {
    relativePath: located.relativePath,
    severity: located.issue.diagnostic.severity,
    code: located.issue.diagnostic.code,
    message: located.issue.diagnostic.message,
    actions: located.issue.actions.map((action) => ({
      code: action.label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'inspect',
      label: action.label,
      sourcePath: located.relativePath,
    })),
  };
}

function uniqueActions(actions: readonly CoggitOperationAction[]): CoggitOperationAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = `${action.code}:${action.operation ?? ''}:${action.sourcePath ?? ''}:${action.scope ?? ''}:${action.maxDepth ?? ''}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cognitionRelativePath(node: CoggitTreeNode): string | null {
  return node.cognitionUri
    ? toRelativeUriPath(node.root.cognitionRootUri, node.cognitionUri)
    : null;
}

function recheckStatusAction(sourcePath: string): CoggitOperationAction {
  return {
    code: 'recheck-status',
    label: 'Re-check the current status of this source path.',
    operation: 'status',
    sourcePath,
  };
}

function addFailure(
  sourcePath: string,
  project: CoggitProjectContext | null,
  suggestedActions: CoggitOperationAction[],
  code: AddOperationErrorCode,
  message: string,
  miss?: {
    pathHints: string[];
    pathMissMessage?: string;
    pathHintMessage?: string;
  },
): AddOperationResult {
  return {
    success: false,
    created: null,
    kind: null,
    sourcePath,
    cognitionPath: null,
    project,
    handbookId: null,
    suggestedActions,
    error: { code, message },
    pathHints: miss?.pathHints ?? [],
    ...(miss?.pathMissMessage ? { pathMissMessage: miss.pathMissMessage } : {}),
    ...(miss?.pathHintMessage ? { pathHintMessage: miss.pathHintMessage } : {}),
  };
}

function resolveFailure(
  sourcePath: string,
  cognitionPath: string | null,
  project: CoggitProjectContext | null,
  suggestedActions: CoggitOperationAction[],
  code: ResolveErrorCode,
  message: string,
  miss?: {
    pathHints: string[];
    pathMissMessage?: string;
    pathHintMessage?: string;
  },
): ResolveOperationResult {
  return {
    success: false,
    sourcePath,
    cognitionPath,
    project,
    sourceKey: null,
    verificationTimeMs: null,
    suggestedActions,
    error: { code, message },
    pathHints: miss?.pathHints ?? [],
    ...(miss?.pathMissMessage ? { pathMissMessage: miss.pathMissMessage } : {}),
    ...(miss?.pathHintMessage ? { pathHintMessage: miss.pathHintMessage } : {}),
  };
}

function classifyAddError(message: string): AddOperationErrorCode {
  if (message.includes('Cannot create leaf') || message.includes('Cannot create skeleton')) {
    return 'invalid-kind';
  }
  if (message.includes('outside project root')) {
    return 'mapping-conflict';
  }
  if (message.includes('not found')) {
    return 'path-not-found';
  }
  if (
    message.includes('EACCES')
    || message.includes('EPERM')
    || message.includes('ENOENT')
  ) {
    return 'filesystem-failure';
  }
  return 'unknown';
}
