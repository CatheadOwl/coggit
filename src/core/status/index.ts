import type {
	CoggitNodeKind,
	CoggitOperationAction,
	CoggitTreeNode,
	CognitionFileInfo,
	CoverageSignals,
	LocatedStatusIssue,
	NodeStatusInspection,
	NodeStatusResult,
	ObservedStatus,
	Reason,
	SourceFileInfo,
	StaleAction,
	StatusAction,
	StatusContext,
	StatusResult,
	SubtreeIssueQueryResult,
	SourceFactKind,
	StatusIssueVisibility,
} from '../types';
import {
	collectEvidence,
	checkDeps,
	checkLinks,
	checkAcceptedPair,
	checkSourceExistence,
	checkSymbols,
	deriveStaleDegree,
	synthesizeStatus,
} from '../evidence';
import { computeSourceFactIdentity } from '../hash';
import { toRelativeUriPath } from '../mapping';
import type { AcceptedPair } from '../registryTypes';

export function projectStatusResultToNodeStatus(status: StatusResult): NodeStatusResult {
	return {
		observedStatus: status.observedStatus,
		ownObservedStatus: status.ownObservedStatus,
		staleAction: status.staleAction,
		issues: status.issues.length > 0 ? status.issues : undefined,
		coverage: status.coverage,
		computedAt: status.computedAt,
	};
}

// ─── Quick mtime observed status ─────────────────────────────────────────────

/**
 * Quick mtime-based observed status check.
 * Returns undefined (no observation possible) when cognition doesn't exist.
 */
export function computeMtimeObservedStatus(
  sourceMtimeMs: number | undefined,
  cognitionMtimeMs: number | undefined,
): ObservedStatus | undefined {
  if (cognitionMtimeMs === undefined) {
    return undefined;
  }
  if (sourceMtimeMs === undefined || cognitionMtimeMs >= sourceMtimeMs) {
    return 'fresh';
  }
  return 'stale';
}

export function combineObservedStatus(
	statuses: Iterable<ObservedStatus | undefined>,
): ObservedStatus | undefined {
	let combined: ObservedStatus | undefined;
	let highestPriority = -1;
	const priorities: Record<ObservedStatus, number> = {
		fresh: 0,
		stale: 1,
		conflict: 2,
	};

	for (const status of statuses) {
		if (status === undefined) {
			continue;
		}
		const priority = priorities[status];
		if (priority > highestPriority) {
			combined = status;
			highestPriority = priority;
		}
	}

	return combined;
}

export interface AggregateNodeStatusInput {
	ownStatus?: NodeStatusResult;
	descendantStatuses?: Iterable<NodeStatusResult | undefined>;
}

export function aggregateNodeStatus(
	input: AggregateNodeStatusInput,
): NodeStatusResult {
	const descendantStatuses = Array.from(input.descendantStatuses ?? [])
		// Skip untracked descendants — only aggregate tracked node status.
		.filter((s) => s?.observedStatus !== undefined);
	const ownStatus = input.ownStatus;
	const descendantObservedStatus = combineObservedStatus(
		descendantStatuses.map((status) => status?.observedStatus),
	);
	const ownObservedStatus = ownStatus?.observedStatus;
	const observedStatus = combineObservedStatus([
		ownObservedStatus,
		descendantObservedStatus,
	]);
	const staleAction = ownStatus?.staleAction
		?? descendantStatuses.find((status) => status?.staleAction !== undefined)?.staleAction;
	const issues = ownStatus?.issues ?? [];
	const ownCoverage = ownStatus?.coverage;
	const hasCoverage = ownCoverage !== undefined
		|| descendantStatuses.some((status) => status?.coverage !== undefined);
	const coverage = hasCoverage
		? {
			ownCognition: ownCoverage?.ownCognition ?? 'not-applicable',
			isMaterializable:
				(ownCoverage?.isMaterializable ?? false)
				|| descendantStatuses.some((status) => status?.coverage?.isMaterializable === true),
			missingMaterializableCount:
				(ownCoverage?.missingMaterializableCount ?? 0)
				+ descendantStatuses.reduce(
					(total, status) => total + (status?.coverage?.missingMaterializableCount ?? 0),
					0,
				),
			coveredCount:
				(ownCoverage?.coveredCount ?? 0)
				+ descendantStatuses.reduce(
					(total, status) => total + (status?.coverage?.coveredCount ?? 0),
					0,
				),
		}
		: undefined;
	const computedAt = [
		ownStatus?.computedAt,
		...descendantStatuses.map((status) => status?.computedAt),
	].reduce<number | undefined>((latest, value) => {
		if (value === undefined) {
			return latest;
		}
		return latest === undefined ? value : Math.max(latest, value);
	}, undefined);

	return {
		observedStatus,
		ownObservedStatus,
		descendantObservedStatus,
		staleAction,
		issues: issues.length > 0 ? issues : undefined,
		coverage,
		computedAt,
	};
}

export function collectSubtreeIssues(node: CoggitTreeNode): LocatedStatusIssue[] {
	const issues: LocatedStatusIssue[] = [];
	const visit = (current: CoggitTreeNode) => {
		for (const issue of current.ownStatus?.issues ?? []) {
			issues.push({
				nodeId: current.id,
				nodeKind: current.kind,
				sourceUri: current.sourceUri,
				cognitionUri: current.cognitionUri,
				cognitionPath: current.cognitionUri
					? toRelativeUriPath(current.root.cognitionRootUri, current.cognitionUri)
					: null,
				relativePath: current.relativePath,
				hasPairedCognition: current.ownStatus?.coverage?.ownCognition === 'present',
				issue,
			});
		}
		for (const child of current.children ?? []) {
			visit(child);
		}
	};
	visit(node);
	return issues;
}

export function querySubtreeIssues(node: CoggitTreeNode): SubtreeIssueQueryResult {
	const subtreeIssues = collectSubtreeIssues(node);
	const ownIssues = subtreeIssues.filter((located) => located.nodeId === node.id);
	const descendantIssues = subtreeIssues.filter((located) => located.nodeId !== node.id);
	return {
		ownIssues,
		descendantIssues,
		totalIssues: subtreeIssues.length,
	};
}

export function countSubtreeIssues(node: CoggitTreeNode): number {
	return querySubtreeIssues(node).totalIssues;
}

function isMaintainedIssue(located: LocatedStatusIssue): boolean {
	return located.hasPairedCognition === true;
}

export function projectStatusIssues(
	issues: SubtreeIssueQueryResult,
	visibility: StatusIssueVisibility = 'maintained',
): SubtreeIssueQueryResult {
	if (visibility === 'all') {
		return issues;
	}
	const ownIssues = issues.ownIssues.filter(isMaintainedIssue);
	const descendantIssues = issues.descendantIssues.filter(isMaintainedIssue);
	return {
		ownIssues,
		descendantIssues,
		totalIssues: ownIssues.length + descendantIssues.length,
	};
}

// ─── NodeStatusInspection builder ──────────────────────────────────────────

export interface InspectNodeStatusInput {
	node: CoggitTreeNode;
	sourcePath: string;
	cognitionPath: string | null;
	handbookId: 'leaf' | 'skeleton' | null;
	issueVisibility?: StatusIssueVisibility;
}

function issueActionsToOperationActions(issues: readonly LocatedStatusIssue[]): CoggitOperationAction[] {
	const actions: CoggitOperationAction[] = [];
	for (const located of issues) {
		for (const action of located.issue.actions) {
			actions.push({
				code: action.label.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '') || 'inspect',
				label: action.label,
				sourcePath: located.relativePath,
			});
		}
	}
	return uniqueOperationActions(actions);
}

function uniqueOperationActions(actions: readonly CoggitOperationAction[]): CoggitOperationAction[] {
	const seen = new Set<string>();
	return actions.filter((action) => {
		const key = `${action.code}:${action.operation ?? ''}:${action.sourcePath ?? ''}`;
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/**
 * Synthesize tool-backed next-step actions from first-class node-level status
 * signals rather than issue labels:
 * - `ownCognition === 'missing'` → `add` (materialize the paired cognition).
 * - own maintained cognition is stale → `resolve` (accept the synced pair).
 *
 * Descendant-only stale status must not synthesize a `resolve` for the parent:
 * only the current node's own maintained cognition being stale qualifies. Issue
 * labels stay label-only through `issueActionsToOperationActions`; this helper
 * is the single place where a node-level signal maps to an operation id.
 */
function synthesizeNodeOperationActions(
	node: CoggitTreeNode,
	sourcePath: string,
): CoggitOperationAction[] {
	const actions: CoggitOperationAction[] = [];
	const ownCoverage = node.ownStatus?.coverage;

	if (ownCoverage?.ownCognition === 'missing') {
		actions.push({
			code: 'create-cognition',
			label: 'Create cognition file',
			operation: 'add',
			sourcePath,
		});
	}

	if (
		ownCoverage?.ownCognition === 'present'
		&& node.ownStatus?.ownObservedStatus === 'stale'
	) {
		actions.push({
			code: 'resolve-stale-cognition',
			label: 'Accept the synced cognition as reviewed',
			operation: 'resolve',
			sourcePath,
		});
	}

	return actions;
}

/**
 * Merge operation-bearing actions (from node signals) with label-only issue
 * actions (edit work). A label-only action that duplicates an operation-bearing
 * action for the same source path and label is dropped: the operation-bearing
 * form names the tool to call, so keeping both would surface one next step
 * twice to a consumer (e.g. the synthesized `add` vs the `missing-cognition`
 * label under the `all` issue visibility).
 */
function mergeSuggestedActions(
	operationActions: readonly CoggitOperationAction[],
	labelActions: readonly CoggitOperationAction[],
): CoggitOperationAction[] {
	const operationKeys = new Set(
		operationActions
			.filter((action) => action.operation !== undefined)
			.map((action) => `${action.sourcePath ?? ''}\u0000${action.label}`),
	);
	const survivingLabels = labelActions.filter(
		(action) => !operationKeys.has(`${action.sourcePath ?? ''}\u0000${action.label}`),
	);
	return uniqueOperationActions([...operationActions, ...survivingLabels]);
}

export function inspectNodeStatus(input: InspectNodeStatusInput): NodeStatusInspection {
	const subtreeIssues = projectStatusIssues(
		querySubtreeIssues(input.node),
		input.issueVisibility,
	);
	const ownIssues = subtreeIssues.ownIssues;
	const descendantIssues = subtreeIssues.descendantIssues;
	const ownActions = issueActionsToOperationActions(ownIssues);
	const descendantActions = issueActionsToOperationActions(descendantIssues);
	const operationActions = synthesizeNodeOperationActions(input.node, input.sourcePath);
	const suggestedActions = mergeSuggestedActions(
		operationActions,
		[...ownActions, ...descendantActions],
	);
	const cognitionPresence = input.node.ownStatus?.coverage?.ownCognition ?? 'not-applicable';

	return {
		sourcePath: input.sourcePath,
		cognitionPath: input.cognitionPath,
		cognitionPresence,
		nodeKind: input.node.kind,
		status: input.node.status?.observedStatus ?? null,
		ownStatus: input.node.status?.ownObservedStatus ?? null,
		descendantStatus: input.node.status?.descendantObservedStatus ?? null,
		issueSummary: {
			total: ownIssues.length + descendantIssues.length,
			own: ownIssues.length,
			descendant: descendantIssues.length,
		},
		subtreeIssues: {
			own: [...ownIssues],
			descendant: descendantIssues,
		},
		suggestedActions,
		handbookId: input.handbookId,
	};
}

// ─── Full 8-State ────────────────────────────────────────────────────────────────

/**
 * Full 8-state status determination — synthesized from the evidence chain.
 * Replaces the Python prototype's 4-state StatusValue (ok/risk/unknown/blocked).
 */
export function computeStatus(
  source: SourceFileInfo,
  cognition: CognitionFileInfo | null,
  context: StatusContext,
): StatusResult {
  const reasons: Reason[] = [];

  // Collect evidence
  const evidence = collectEvidence(source, cognition);

  // Per-dimension checks
	reasons.push(...checkAcceptedPair(source, cognition));
  reasons.push(...checkSymbols(source, cognition, context.symbolIndex));
  reasons.push(...checkLinks(cognition, context.linkIndex));
  reasons.push(...checkDeps(source, context.depGraph));
  reasons.push(...checkSourceExistence(source, cognition));

  // Deterministic decision tree synthesis
  const synthesized = synthesizeStatus(reasons, evidence);
	const staleAction = staleActionForStatus(synthesized.observedStatus, evidence);

	// Attach concrete file paths to each issue for actionability
	const issues = synthesized.issues.map((statusIssue) => ({
		...statusIssue,
		diagnostic: {
			...statusIssue.diagnostic,
			relatedPaths: cognition
				? [source.uri, cognition.uri]
				: [source.uri],
		},
	}));

	return {
		observedStatus: synthesized.observedStatus,
		ownObservedStatus: synthesized.ownObservedStatus,
		staleAction,
		issues,
		coverage: synthesized.coverage,
		reasons,
		evidence,
		computedAt: Date.now(),
	};
}

function staleActionForStatus(
	observedStatus: ObservedStatus | undefined,
	evidence: StatusResult['evidence'],
): StaleAction | undefined {
	if (observedStatus !== 'stale') {
		return undefined;
	}

	const staleDegree = deriveStaleDegree(evidence);
	return staleDegree.availability === 'available'
		&& staleDegree.score !== null
		&& staleDegree.score >= 0.5
		? 'align-cognition-first'
		: undefined;
}

// ─── Summary ──────────────────────────────────────────────────────────────────────

/**
 * Summarizes the most recent representativeMtime among child nodes.
 */
export function summarizeRepresentativeMtime(
	children: CoggitTreeNode[],
): number | undefined {
	let latest: number | undefined;
	for (const child of children) {
		if (child.representativeMtimeMs === undefined) {
			continue;
		}
		latest =
			latest === undefined
				? child.representativeMtimeMs
				: Math.max(latest, child.representativeMtimeMs);
	}
	return latest;
}

export interface RuntimeStatusInput {
	sourceUri: string;
	sourceContent: string;
	sourceFactKind?: SourceFactKind;
	sourceMtimeMs: number;
	cognitionUri: string | null;
	cognitionContent: string | null;
	cognitionMtimeMs: number | null;
	verificationTimeMs?: number | null;
	acceptedPair?: AcceptedPair | null;
	context?: Partial<StatusContext>;
}

export function computeRuntimeStatus(input: RuntimeStatusInput): StatusResult {
	const sourceBlobHash = computeSourceFactIdentity(input.sourceFactKind ?? 'file-content', input.sourceContent);
	const sourceInfo: SourceFileInfo = {
		uri: input.sourceUri,
		mtimeMs: input.sourceMtimeMs,
		content: input.sourceContent,
		blobHash: sourceBlobHash,
		sourceFactKind: input.sourceFactKind ?? 'file-content',
		publicSymbols: [],
		dependencies: [],
	};

	const cognitionInfo: CognitionFileInfo | null = input.cognitionContent !== null
		? {
				uri: input.cognitionUri ?? '',
				mtimeMs: input.cognitionMtimeMs,
				content: input.cognitionContent,
				verificationTimeMs: input.verificationTimeMs ?? null,
				acceptedPair: input.acceptedPair,
				links: [],
				brokenLinks: [],
			}
		: null;

	const context: StatusContext = {
		symbolIndex: input.context?.symbolIndex ?? new Map(),
		linkIndex: input.context?.linkIndex ?? new Map(),
		depGraph: input.context?.depGraph ?? new Map(),
	};

	return computeStatus(sourceInfo, cognitionInfo, context);
}

// ─── Lightweight content helper ───────────────────────────────────────────

/**
 * Lightweight helper for callers that only have raw text and mtimes.
 *
 * This is not the full evidence pipeline: URI, verification metadata,
 * symbols, links, and dependency context are intentionally unavailable here.
 * Runtime code should prefer computeStatus() whenever those facts are known.
 */
export function computeStatusFromContent(
  sourceContent: string,
  cognitionContent: string | null,
  sourceMtimeMs: number,
  cognitionMtimeMs: number | null,
  context?: Partial<StatusContext>,
): ObservedStatus | undefined {
  const sourceBlobHash = computeSourceFactIdentity('file-content', sourceContent);

  const sourceInfo: SourceFileInfo = {
    uri: '',
    mtimeMs: sourceMtimeMs,
    content: sourceContent,
    blobHash: sourceBlobHash,
    publicSymbols: [],
    dependencies: [],
  };

  const cognitionInfo: CognitionFileInfo | null = cognitionContent !== null
    ? {
        uri: '',
        mtimeMs: cognitionMtimeMs ?? 0,
        content: cognitionContent,
        verificationTimeMs: null,
        links: [],
        brokenLinks: [],
      }
    : null;

  const fullContext: StatusContext = {
    symbolIndex: context?.symbolIndex ?? new Map(),
    linkIndex: context?.linkIndex ?? new Map(),
    depGraph: context?.depGraph ?? new Map(),
  };

  return computeStatus(sourceInfo, cognitionInfo, fullContext).observedStatus;
}

// ─── Status Label ────────────────────────────────────────────────────────────────

/**
 * Map an ObservedStatus to a human-readable label.
 */
export function describeObservedStatus(
  status: ObservedStatus | undefined,
): string | undefined {
  switch (status) {
    case 'fresh':
      return 'Fresh';
    case 'stale':
      return 'Stale';
    case 'conflict':
      return 'Conflict';
    default:
      return undefined;
  }
}

export const __testing__ = {
  computeRuntimeStatus,
  computeMtimeObservedStatus,
  computeStatusFromContent,
  combineObservedStatus,
  aggregateNodeStatus,
  collectSubtreeIssues,
  querySubtreeIssues,
  countSubtreeIssues,
  projectStatusIssues,
  summarizeRepresentativeMtime,
  inspectNodeStatus,
};
