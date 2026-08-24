import type { UriComponents } from '../interfaces';
import type { CoggitOperationAction } from '../operationTypes';
import type { CoggitNodeKind } from '../snapshotTypes';
import type { AcceptedPair } from '../registryTypes';

export type ObservedStatus = 'fresh' | 'stale' | 'conflict';

export type SourceFactKind = 'file-content' | 'directory-entry';

export interface EvidenceDiagnostic {
	code:
		| 'missing-cognition'
		| 'template-cognition'
		| 'outdated-cognition'
		| 'folder-structure-changed'
		| 'missing-coverage'
		| 'broken-links'
		| 'metadata-broken'
		| 'source-deleted'
		| 'conflicting-evidence'
	| 'folder-structure-outdated';
	severity: 'info' | 'warning' | 'error';
	message: string;
	relatedPaths?: string[];
}

export interface StatusAction {
	label: string;
}

export interface StatusIssue {
	diagnostic: EvidenceDiagnostic;
	actions: StatusAction[];
}

export type CognitionCoveragePresence = 'present' | 'missing' | 'not-applicable';

export interface CoverageSignals {
	ownCognition: CognitionCoveragePresence;
	isMaterializable: boolean;
	missingMaterializableCount: number;
	coveredCount: number;
}

export type MaintenanceRecommendation = 'none' | 'optional' | 'recommended' | 'urgent';
export type StaleAction = 'align-cognition-first';

export interface NodeStatusResult {
	observedStatus?: ObservedStatus;
	ownObservedStatus?: ObservedStatus;
	descendantObservedStatus?: ObservedStatus;
	staleAction?: StaleAction;
	/** Own-node issues only. Subtree diagnostics are queried with collectSubtreeIssues(). */
	issues?: StatusIssue[];
	coverage?: CoverageSignals;
	computedAt?: number;
}

export interface LocatedStatusIssue {
	nodeId: string;
	nodeKind: CoggitNodeKind;
	sourceUri: UriComponents;
	/** Expected paired cognition URI. Optional: absent for nodes with no
	 *  expected cognition URI (e.g. the `error` node kind built by
	 *  `createErrorNode`); mirrors `CoggitTreeNode.cognitionUri`. */
	cognitionUri?: UriComponents;
	/**
	 * Expected paired cognition path, cognition-root-relative. Non-null for any
	 * real node (derived from the node's `cognitionUri`); `null` only for nodes
	 * with no `cognitionUri`. This is the *expected* target path — it does not
	 * assert that the document exists. Null is encoded as `null` (not
	 * `undefined`) to match `StatusOperationResult.cognitionPath`: the two
	 * fields share one meaning, so they share one null encoding.
	 */
	cognitionPath: string | null;
	relativePath: string;
	hasPairedCognition?: boolean;
	issue: StatusIssue;
}

export interface SubtreeIssueQueryResult {
	ownIssues: LocatedStatusIssue[];
	descendantIssues: LocatedStatusIssue[];
	totalIssues: number;
}

export type StatusIssueVisibility = 'maintained' | 'all';

export type ReasonKind =
	| 'outdated-mtime'
	| 'source-changed'
	| 'unverified'
	| 'broken-links'
	| 'missing-coverage'
	| 'missing-metadata'
	| 'corrupted-metadata'
	| 'dep-mismatch'
	| 'semantic-edge-changed'
	| 'acceptance-order-unknown'
	| 'symbol-changed'
	| 'structural-edge-changed'
	| 'source-deleted'
	| 'source-renamed';

export interface Reason {
	kind: ReasonKind;
	severity: 'info' | 'warning' | 'error';
	message: string;
	relatedPaths?: string[];
}

export interface SourceFactIdentity {
	kind: SourceFactKind;
	currentHash: string;
}

export interface TextMetrics {
	charLength: number;
	lineCount: number;
	nonEmptyLineCount: number;
}

export interface SourceChangeMetrics {
	basis: 'unavailable' | 'git-diff' | 'snapshot';
	changedLines: number | null;
	changeRatio: number | null;
}

export interface StaleDegreeResult {
	availability: 'available' | 'unavailable' | 'not-applicable';
	score: number | null;
	recommendation: MaintenanceRecommendation | null;
	confidence: 'none' | 'low' | 'medium' | 'high';
	reason: string;
}

export interface Evidence {
	sourceMtimeMs: number;
	sourceBlobHash: string;
	cognitionMtimeMs: number | null;
	verificationTimeMs?: number | null;
	sourceFactIdentity: SourceFactIdentity;
	acceptedPair?: AcceptedPair | null;
	cognitionBlobHash?: string | null;
	cognitionChangedSinceAccepted?: boolean;
	sourceChangedSinceAccepted?: boolean;
	sourceMetrics: TextMetrics;
	cognitionMetrics: TextMetrics | null;
	changeMetrics: SourceChangeMetrics;
	changedSymbols: string[];
	brokenLinks: LinkCheckResult[];
	gitCommitsSinceVerified: number;
	/** Whether cognition exists but still has only template-like content. */
	cognitionContentIsTemplate: boolean;
	/** Orphan detection: cognition exists while source no longer exists. */
	sourceDeleted: boolean;
}

export interface StatusResult {
	observedStatus?: ObservedStatus;
	ownObservedStatus?: ObservedStatus;
	staleAction?: StaleAction;
	issues: StatusIssue[];
	coverage: CoverageSignals;
	reasons: Reason[];
	evidence: Evidence;
	computedAt: number;
}

/**
 * Per-node triage fact synthesized during inspection: one entry per
 * issue-bearing node in the projected issue set, grouping that node's issues
 * with its node-scoped workflow actions. This is the subtree-maintenance
 * counterpart to the single-node `suggestedActions` channel; the
 * [[statusTriage.ts]] projection maps these facts into the adapter-ready
 * `StatusTriageView`.
 */
export interface NodeStatusTriageEntry {
	/** Source-root-relative path of the issue-bearing node. */
	sourcePath: string;
	/**
	 * Expected paired cognition path, cognition-root-relative; same expected-path
	 * semantics and null encoding as `NodeStatusInspection.cognitionPath`.
	 */
	cognitionPath: string | null;
	nodeKind: CoggitNodeKind;
	/** Whether this entry is the inspected node itself or a descendant. */
	relation: 'own' | 'descendant';
	/** This node's issues under the selected issue visibility. */
	issues: LocatedStatusIssue[];
	/**
	 * Node-scoped workflow actions synthesized from this node's own
	 * status/coverage signals. Structured-only (carries `operation` or
	 * `handbookId`): label-only issue guidance stays in the entry's
	 * `issues[].issue.actions` and is never echoed here, so consumers never
	 * re-judge which actions are workflow. The own entry is facts-only and
	 * always `[]`: the inspected node's next steps remain exclusively in the
	 * top-level `suggestedActions` channel, so no action appears in two
	 * channels. Error nodes carry no synthesized actions.
	 */
	actions: CoggitOperationAction[];
}

export interface NodeStatusInspection {
	sourcePath: string;
	/**
	 * Expected paired cognition path, cognition-root-relative; `null` only when
	 * the node has no expected cognition URI. This is the *expected* target
	 * path, not an existence check — pair it with `cognitionPresence`.
	 */
	cognitionPath: string | null;
	cognitionPresence: CognitionCoveragePresence;
	nodeKind: CoggitNodeKind;
	/**
	 * Whole-node observed status: the worst of `ownStatus` and `descendantStatus`
	 * by `fresh` < `stale` < `conflict`. `null` means "no cognition" (neither the
	 * node nor any tracked descendant has an observed status).
	 */
	status: ObservedStatus | null;
	/**
	 * This node's own observed status, before descendant aggregation; `null`
	 * means "no own cognition".
	 */
	ownStatus: ObservedStatus | null;
	/**
	 * Worst observed status over descendants with an observed status (the
	 * tracked node-status subset) by `fresh` < `stale` < `conflict`. `null` means
	 * no descendant in that subset has an observed status (untracked descendants
	 * are skipped) — not "no cognition".
	 */
	descendantStatus: ObservedStatus | null;
	issueSummary: {
		total: number;
		own: number;
		descendant: number;
	};
	/** Always present with `own`/`descendant` arrays; `[]` means "none". */
	subtreeIssues: {
		own: LocatedStatusIssue[];
		descendant: LocatedStatusIssue[];
	};
	suggestedActions: CoggitOperationAction[];
	/**
	 * One entry per issue-bearing node in the projected issue set: the own
	 * entry first (when the inspected node has issues), then descendant entries
	 * in subtree collection order. Descendant entries carry node-scoped actions
	 * synthesized from node signals; adapters render subtree workflow from these
	 * entries, not from `suggestedActions`.
	 */
	triage: NodeStatusTriageEntry[];
	handbookId: 'leaf' | 'skeleton' | null;
}

export interface SourceFileInfo {
	uri: string;
	mtimeMs: number;
	content: string;
	blobHash: string;
	sourceFactKind?: SourceFactKind;
	publicSymbols: string[];
	dependencies: string[];
}

export interface CognitionFileInfo {
	uri: string;
	mtimeMs: number | null;
	content: string | null;
	verificationTimeMs?: number | null;
	acceptedPair?: AcceptedPair | null;
	links: Array<{ text: string; target: string }>;
	brokenLinks: LinkCheckResult[];
}

export interface LinkCheckResult {
	text: string;
	target: string;
	reason: 'not-found' | 'external' | 'cyclic' | 'invalid-format';
	sourceLine: number;
}

export interface StatusContext {
	symbolIndex: Map<string, string[]>;
	linkIndex: Map<string, LinkCheckResult[]>;
	depGraph: Map<string, string[]>;
}
