import type { UriComponents } from './interfaces';
import type { CoggitOperationAction } from './operationTypes';
import type { CoggitNodeKind } from './snapshotTypes';
import type { AcceptedPair } from './registryTypes';

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
	cognitionUri?: UriComponents;
	relativePath: string;
	issue: StatusIssue;
}

export interface SubtreeIssueQueryResult {
	ownIssues: LocatedStatusIssue[];
	descendantIssues: LocatedStatusIssue[];
	totalIssues: number;
}

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

export interface NodeStatusInspection {
	sourcePath: string;
	cognitionPath: string | null;
	nodeKind: CoggitNodeKind;
	status: ObservedStatus | null;
	ownStatus: ObservedStatus | null;
	descendantStatus: ObservedStatus | null;
	issueSummary: {
		total: number;
		own: number;
		descendant: number;
	};
	subtreeIssues: {
		own: LocatedStatusIssue[];
		descendant: LocatedStatusIssue[];
	};
	suggestedActions: CoggitOperationAction[];
	handbookId: 'leaf' | 'skeleton' | null;
	verify: {
		tool: 'coggit_status';
		sourcePath: string;
	} | null;
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
