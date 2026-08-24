import type { CoggitOperationAction, CoggitProjectContext } from './operationTypes';
import type { ObservedStatus } from './status/statusTypes';

export type CognitionDocumentKind = 'leaf' | 'folder';

export interface CognitionFrontmatterMetadata {
	type?: string;
	layer?: string;
	module?: string;
	kind?: string;
	tags?: string[];
	apiSurface?: string[];
	retrieval?: {
		summary?: string;
		intents?: string[];
	};
	[key: string]: unknown;
}

export interface CognitionFrontmatter {
	name: string | null;
	description: string | null;
	metadata: CognitionFrontmatterMetadata;
	raw: Record<string, unknown>;
}

export interface CognitionHeading {
	depth: 1 | 2 | 3 | 4 | 5 | 6;
	text: string;
	line: number;
	slug: string;
}

export interface CognitionDocumentMetrics {
	charLength: number;
	lineCount: number;
	nonEmptyLineCount: number;
	contentHash: string;
	mtimeMs: number;
}

export interface CognitionDocumentDiagnostic {
	code:
		| 'missing-frontmatter'
		| 'malformed-frontmatter'
		| 'missing-name'
		| 'missing-description'
		| 'weak-description'
		| 'missing-metadata-type'
		| 'invalid-metadata-tags'
		| 'invalid-metadata-api-surface'
		| 'invalid-metadata-retrieval-intents'
		| 'duplicate-cognition-key'
		| 'source-path-outside-source-root'
		| 'unreadable-cognition-file';
	severity: 'info' | 'warning' | 'error';
	message: string;
}

export interface CognitionDocumentFacts {
	cognitionPath: string;
	key: string;
	kind: CognitionDocumentKind;
	frontmatter: CognitionFrontmatter;
	headings: CognitionHeading[];
	metrics: CognitionDocumentMetrics;
	diagnostics: CognitionDocumentDiagnostic[];
}

export type CognitionMetadataQuality = 'good' | 'usable' | 'poor';
export type CognitionContextStaleRisk = 'low' | 'medium' | 'high' | 'unknown';

export interface CognitionRoutes {
	project: CoggitProjectContext;
	generatedAt: number;
	entries: CognitionRoutesEntry[];
	diagnostics: CognitionDocumentDiagnostic[];
}

export interface CognitionRoutesEntry {
	key: string;
	projectRelativeSourcePath: string | null;
	toolSourcePath: string | null;
	cognitionPath: string;
	documentKind: CognitionDocumentKind;
	metadataType: string | null;
	identity: CognitionContextIdentity;
	document: CognitionContextDocumentSummary;
	quality: CognitionContextQuality;
	status: CognitionContextStatus;
	diagnostics: CognitionDocumentDiagnostic[];
	suggestedActions: CoggitOperationAction[];
}

export interface CognitionContextIdentity {
	name: string | null;
	description: string | null;
	retrievalSummary: string | null;
	retrievalIntents: string[];
	tags: string[];
}

export interface CognitionContextDocumentSummary {
	metrics: CognitionDocumentMetrics;
	headings: CognitionHeading[];
	headingCount: number;
}

export interface CognitionContextQuality {
	metadataQuality: CognitionMetadataQuality;
	staleRisk: CognitionContextStaleRisk;
}

export interface CognitionContextStatus {
	observedStatus: ObservedStatus | null;
	staleRisk: CognitionContextStaleRisk;
}

export interface RoutesProjectionNode {
	path: string;
	cognition?: string;
	description?: string;
	truncated?: boolean;
	omittedChildrenCount?: number;
	children?: RoutesProjectionNode[];
}
