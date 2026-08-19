import type {
	CognitionFileInfo,
	CoverageSignals,
	Evidence,
	EvidenceDiagnostic,
	LinkCheckResult,
	MaintenanceRecommendation,
	ObservedStatus,
	Reason,
	SourceFileInfo,
	StaleDegreeResult,
	StatusContext,
	StatusIssue,
	TextMetrics,
	SourceFactKind,
} from './types';
import { computeCognitionIdentity, computeSourceFactIdentity } from './hash';
import { latestAcceptedTime } from './time';

// ─── Evidence Collection ──────────────────────────────────────────────────────────────────

/**
 * Collects structured evidence between source and cognition.
 * All check functions are pure for easy unit testing.
 */
export function collectEvidence(
	source: SourceFileInfo,
	cognition: CognitionFileInfo | null,
): Evidence {
	const sourceFactIdentity = {
		kind: source.sourceFactKind ?? 'file-content',
		currentHash: source.blobHash,
	};
	const acceptedPair = cognition?.acceptedPair;
	const cognitionBlobHash = cognition?.content === null || cognition?.content === undefined
		? null
		: computeCognitionIdentity(cognition.content);
	const sourceChangedSinceAccepted = acceptedPair === undefined
		? cognition !== null
			&& latestAcceptedTime(cognition?.mtimeMs ?? null, cognition?.verificationTimeMs ?? null) !== null
			&& source.mtimeMs > (latestAcceptedTime(cognition?.mtimeMs ?? null, cognition?.verificationTimeMs ?? null) ?? 0)
		: acceptedPair !== null
			&& source.blobHash !== acceptedPair.source;
	const cognitionChangedSinceAccepted = acceptedPair !== undefined && acceptedPair !== null
		&& cognitionBlobHash !== null
		&& cognitionBlobHash !== acceptedPair.cognition;

	return {
		sourceMtimeMs: source.mtimeMs,
		sourceBlobHash: source.blobHash,
		cognitionMtimeMs: cognition?.mtimeMs ?? null,
		verificationTimeMs: cognition?.verificationTimeMs ?? null,
		sourceFactIdentity,
		acceptedPair,
		cognitionBlobHash,
		cognitionChangedSinceAccepted,
		sourceChangedSinceAccepted,
		sourceMetrics: computeTextMetrics(source.content),
		cognitionMetrics: cognition?.content !== null && cognition?.content !== undefined
			? computeTextMetrics(cognition.content)
			: null,
		changeMetrics: {
			basis: 'unavailable',
			changedLines: null,
			changeRatio: null,
		},
		changedSymbols: [],
		brokenLinks: cognition?.brokenLinks ?? [],
		gitCommitsSinceVerified: 0,
		cognitionContentIsTemplate:
			cognition !== null &&
			cognition.content !== null &&
			isTemplateContent(cognition.content),
		sourceDeleted: false,
	};
}

function computeTextMetrics(content: string): TextMetrics {
	const lines = content.length === 0 ? [] : content.split(/\r\n|\r|\n/);
	return {
		charLength: content.length,
		lineCount: lines.length,
		nonEmptyLineCount: lines.filter((line) => line.trim().length > 0).length,
	};
}

function recommendationFromScore(score: number): MaintenanceRecommendation {
	if (score === 0) {
		return 'none';
	}
	if (score < 0.2) {
		return 'optional';
	}
	if (score < 0.5) {
		return 'recommended';
	}
	return 'urgent';
}

function scoreFromChangeRatio(changeRatio: number): number {
	if (!Number.isFinite(changeRatio)) {
		return 0;
	}
	return Math.max(0, Math.min(1, changeRatio));
}

export function deriveStaleDegree(evidence: Evidence): StaleDegreeResult {
	if (evidence.cognitionMtimeMs === null) {
		return {
			availability: 'not-applicable',
			score: null,
			recommendation: null,
			confidence: 'none',
			reason: 'Cognition is missing, so stale degree is not applicable.',
		};
	}

	if (evidence.sourceDeleted) {
		return {
			availability: 'not-applicable',
			score: null,
			recommendation: null,
			confidence: 'none',
			reason: 'Source is deleted, so stale degree is not applicable.',
		};
	}

	if (evidence.sourceFactIdentity.currentHash !== evidence.sourceBlobHash) {
		return {
			availability: 'unavailable',
			score: null,
			recommendation: null,
			confidence: 'none',
			reason: 'Evidence hashes are inconsistent, so stale degree cannot be derived.',
		};
	}

	if (!sourceChangedSinceAccepted(evidence)) {
		return {
			availability: 'available',
			score: 0,
			recommendation: 'none',
			confidence: 'high',
			reason: 'Source fact has not changed since the latest accepted cognition-side event.',
		};
	}

	if (evidence.changeMetrics.changeRatio !== null) {
		const score = scoreFromChangeRatio(evidence.changeMetrics.changeRatio);
		return {
			availability: 'available',
			score,
			recommendation: recommendationFromScore(score),
			confidence: evidence.changeMetrics.basis === 'unavailable' ? 'low' : 'medium',
			reason: `Source fact changed since the latest accepted cognition-side event with change ratio ${score.toFixed(2)}.`,
		};
	}

	return {
		availability: 'available',
		score: 0.35,
		recommendation: 'optional',
		confidence: 'low',
		reason: 'Source fact changed since the latest accepted cognition-side event, but changed-line evidence is unavailable.',
	};
}

/**
 * Determines whether cognition content is only a skeleton template (no substantive analysis).
 * Rule: pure headings, heading + empty lines only, or fewer than 3 effective content lines are treated as template.
 */
export function isTemplateContent(content: string | null): boolean {
	if (content === null || content.trim().length === 0) {
		return true;
	}

	const nonEmptyLines = content
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	// Only headings/empty lines/few placeholder text
	if (nonEmptyLines.length <= 2) {
		return true;
	}

	// All headings (# lines only) with no body content
	const contentLines = nonEmptyLines.filter((l) => !l.startsWith('#'));
	return contentLines.length === 0;
}

// ─── Reason Check Functions ───────────────────────────────────────────────────────────

export function checkMtime(
	source: SourceFileInfo,
	cognition: CognitionFileInfo | null,
): Reason[] {
	const reasons: Reason[] = [];
	if (cognition === null) {
		return reasons;
	}
	if (cognition.mtimeMs !== null && source.mtimeMs > cognition.mtimeMs) {
		reasons.push({
			kind: 'outdated-mtime',
			severity: 'warning',
			message: `Source file modified after cognition file (source: ${new Date(source.mtimeMs).toISOString()}, cognition: ${new Date(cognition.mtimeMs).toISOString()})`,
			relatedPaths: [source.uri, cognition.uri],
		});
	}
	return reasons;
}

export function checkAcceptedPair(
	source: SourceFileInfo,
	cognition: CognitionFileInfo | null,
): Reason[] {
	if (cognition === null || cognition.content === null) {
		return [];
	}
	const acceptedPair = cognition.acceptedPair;
	if (acceptedPair === undefined) {
		if (cognition.mtimeMs !== null
			&& source.mtimeMs > Math.max(cognition.mtimeMs, cognition.verificationTimeMs ?? Number.NEGATIVE_INFINITY)) {
			return checkMtime(source, cognition);
		}
		return [];
	}
	if (acceptedPair === null) {
		return [{
			kind: 'unverified',
			severity: 'warning',
			message: 'Cognition has no accepted source relationship.',
			relatedPaths: [source.uri, cognition.uri],
		}];
	}
	const sourceIdentity = computeSourceFactIdentity(
		source.sourceFactKind ?? 'file-content',
		source.content,
	);
	const cognitionIdentity = computeCognitionIdentity(cognition.content);
	if (sourceIdentity === acceptedPair.source && cognitionIdentity === acceptedPair.cognition) {
		return [];
	}
	if (sourceIdentity !== acceptedPair.source && cognitionIdentity !== acceptedPair.cognition) {
		return [{
			kind: 'acceptance-order-unknown',
			severity: 'warning',
			message: 'Both source and cognition changed without acceptance order evidence.',
			relatedPaths: [source.uri, cognition.uri],
		}];
	}
	return [{
		kind: sourceIdentity !== acceptedPair.source ? 'source-changed' : 'unverified',
		severity: 'warning',
		message: sourceIdentity !== acceptedPair.source
			? 'Source content changed since the accepted cognition relationship.'
			: 'Cognition content is not the accepted cognition relationship.',
		relatedPaths: [source.uri, cognition.uri],
	}];
}

export function checkSymbols(
	source: SourceFileInfo,
	cognition: CognitionFileInfo | null,
	symbolIndex: StatusContext['symbolIndex'],
): Reason[] {
	const reasons: Reason[] = [];
	if (cognition === null) {
		return reasons;
	}

	const cognitionSymbols = symbolIndex.get(cognition.uri) ?? [];
	const missingSymbols = source.publicSymbols.filter(
		(s) => !cognitionSymbols.includes(s),
	);
	if (missingSymbols.length > 0) {
		reasons.push({
			kind: 'symbol-changed',
			severity: 'warning',
			message: `New public symbols not documented in cognition: ${missingSymbols.join(', ')}`,
			relatedPaths: [source.uri, cognition.uri],
		});
	}
	return reasons;
}

export function checkLinks(
	cognition: CognitionFileInfo | null,
	linkIndex: StatusContext['linkIndex'],
): Reason[] {
	const reasons: Reason[] = [];
	if (cognition === null) {
		return reasons;
	}

	const brokenLinks = linkIndex.get(cognition.uri) ?? [];
	if (brokenLinks.length > 0) {
		reasons.push({
			kind: 'broken-links',
			severity: 'warning',
			message: `Cognition file has ${brokenLinks.length} broken link(s)`,
			relatedPaths: [cognition.uri, ...brokenLinks.map((l) => l.target)],
		});
	}
	return reasons;
}

export function checkDeps(
	source: SourceFileInfo,
	depGraph: StatusContext['depGraph'],
): Reason[] {
	const reasons: Reason[] = [];
	const deps = depGraph.get(source.uri) ?? [];
	const missingDeps = deps.filter((dep) => !depGraph.has(dep));

	if (missingDeps.length > 0) {
		reasons.push({
			kind: 'dep-mismatch',
			severity: 'info',
			message: `Source depends on ${missingDeps.length} file(s) not in dependency graph`,
			relatedPaths: missingDeps,
		});
	}
	return reasons;
}

export function checkSourceExistence(
	source: SourceFileInfo,
	cognition: CognitionFileInfo | null,
): Reason[] {
	const reasons: Reason[] = [];
	if (cognition === null) {
		return reasons;
	}
	// Note: orphaned detection (cognition exists but source deleted)
	// is handled at the Evidence level via `sourceDeleted`.
	// This function handles the case where the source doesn't exist.
	return reasons;
}

function issue(
	diagnostic: EvidenceDiagnostic,
	...actionLabels: string[]
): StatusIssue {
	return {
		diagnostic,
		actions: actionLabels.map((label) => ({ label })),
	};
}

function issueForOutdatedSourceFact(kind: SourceFactKind): StatusIssue {
	if (kind === 'directory-entry') {
		return issue(
			{
				code: 'folder-structure-outdated',
				severity: 'warning',
				message: 'Stale folder README.',
			},
			SYNC_FOLDER_README_ACTION_LABEL,
		);
	}

	return issue(
		{
			code: 'outdated-cognition',
			severity: 'warning',
			message: 'Stale cognition.',
		},
		SYNC_COGNITION_ACTION_LABEL,
	);
}

/**
 * Single-source edit-work labels for stale pairs. The status inspection
 * reuses these exact labels on its synthesized handbook-bearing sync action,
 * so the issue action and the next-step action always dedup by label match.
 */
export const SYNC_COGNITION_ACTION_LABEL = 'Sync cognition with source changes';
export const SYNC_FOLDER_README_ACTION_LABEL = 'Sync folder README with child structure changes';

export function actionLabelsFromIssues(issues: Iterable<StatusIssue> | undefined): string[] {
	return Array.from(issues ?? []).flatMap((statusIssue) =>
		statusIssue.actions.map((action) => action.label),
	);
}

/**
 * Synthesizes the final 8-state from reasons.
 * Uses a deterministic decision tree (not a weighted model) — see DECISIONS documentation.
 */
export function synthesizeStatus(
	reasons: Reason[],
	evidence: Evidence,
): {
	observedStatus: ObservedStatus | undefined;
	ownObservedStatus: ObservedStatus | undefined;
	issues: StatusIssue[];
	coverage: CoverageSignals;
} {
	if (evidence.cognitionMtimeMs === null) {
		return {
			observedStatus: undefined,
			ownObservedStatus: undefined,
			issues: [issue(
				{ code: 'missing-cognition', severity: 'info', message: 'Source file has no paired cognition file.' },
				'Create cognition file',
			)],
			coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
		};
	}

	if (evidence.sourceDeleted) {
		return {
			observedStatus: 'stale',
			ownObservedStatus: 'stale',
			issues: [issue(
				{ code: 'source-deleted', severity: 'error', message: 'Cognition exists but the paired source appears deleted.' },
				'Remove orphaned cognition file or restore source',
			)],
			coverage: { ownCognition: 'not-applicable', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 0 },
		};
	}

	const kinds = new Set(reasons.map((r) => r.kind));
	const errors = reasons.filter((r) => r.severity === 'error');

	if (kinds.has('acceptance-order-unknown')) {
		return {
			observedStatus: 'stale',
			ownObservedStatus: 'stale',
			issues: [issueForOutdatedSourceFact(evidence.sourceFactIdentity.kind)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	if (kinds.has('semantic-edge-changed')) {
		return {
			observedStatus: 'conflict',
			ownObservedStatus: 'conflict',
			issues: [issue(
				{ code: 'conflicting-evidence', severity: 'error', message: 'Source and cognition both changed without acceptance order evidence.' },
				'Review and accept the current source/cognition pair',
			)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	if (errors.length > 0) {
		return {
			observedStatus: 'conflict',
			ownObservedStatus: 'conflict',
			issues: [issue(
				{ code: 'metadata-broken', severity: 'error', message: 'Status evidence is broken or inconsistent.' },
				'Check registry or recreate cognition file',
			)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	if (kinds.has('broken-links')) {
		return {
			observedStatus: 'stale',
			ownObservedStatus: 'stale',
			issues: [issue(
				{ code: 'broken-links', severity: 'warning', message: 'Cognition exists but projected coverage is incomplete.' },
				'Fix broken links in cognition file',
			)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	if (kinds.has('symbol-changed') || kinds.has('source-changed') || kinds.has('unverified')) {
		return {
			observedStatus: 'stale',
			ownObservedStatus: 'stale',
			issues: [issueForOutdatedSourceFact(evidence.sourceFactIdentity.kind)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	if (evidence.cognitionContentIsTemplate) {
		return {
			observedStatus: 'stale',
			ownObservedStatus: 'stale',
			issues: [issue(
				{ code: 'template-cognition', severity: 'info', message: 'Cognition file exists but still looks like a template.' },
				'Fill in cognition content',
			)],
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};
	}

	return {
		observedStatus: 'fresh',
		ownObservedStatus: 'fresh',
		issues: [],
		coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
	};
}

/**
 * Derives recommended actions based on status and reasons.
 */
export function deriveActions(
	synthesized: { observedStatus: ObservedStatus | undefined; issues: StatusIssue[]; coverage: CoverageSignals },
	_reasons: Reason[],
): string[] {
	return actionLabelsFromIssues(synthesized.issues);
}

function sourceChangedSinceAccepted(evidence: Evidence): boolean {
	return evidence.sourceChangedSinceAccepted ?? false;
}
