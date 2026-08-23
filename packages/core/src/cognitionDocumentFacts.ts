import { parseDocument } from 'yaml';

import { computeBlobHash } from './hash';
import { cognitionPathToKey } from './identity';
import type {
	CognitionDocumentDiagnostic,
	CognitionDocumentFacts,
	CognitionDocumentKind,
	CognitionFrontmatter,
	CognitionFrontmatterMetadata,
	CognitionHeading,
} from './types';

export interface ParseCognitionDocumentFactsOptions {
	mtimeMs?: number;
}

interface FrontmatterParseResult {
	frontmatter: CognitionFrontmatter;
	body: string;
	bodyLineOffset: number;
	diagnostics: CognitionDocumentDiagnostic[];
}

const EMPTY_FRONTMATTER: CognitionFrontmatter = {
	name: null,
	description: null,
	metadata: {},
	raw: {},
};

const PLACEHOLDER_PATTERNS = [
	/^<.*>$/u,
	/^todo$/iu,
	/^tbd$/iu,
	/^n\/a$/iu,
	/^cognition (leaf|file|folder|document) for /iu,
	/^<one-line /iu,
];

export function parseCognitionDocumentFacts(
	cognitionPath: string,
	content: string,
	options: ParseCognitionDocumentFactsOptions = {},
): CognitionDocumentFacts {
	const key = cognitionPathToKey(cognitionPath);
	const kind = kindFromKey(key);
	const parsed = parseFrontmatter(content);
	const diagnostics = [
		...parsed.diagnostics,
		...validateFrontmatter(parsed.frontmatter),
	];

	return {
		cognitionPath: cognitionPath.replace(/\\/g, '/'),
		key,
		kind,
		frontmatter: parsed.frontmatter,
		headings: extractHeadings(parsed.body, parsed.bodyLineOffset),
		metrics: {
			charLength: content.length,
			lineCount: countLines(content),
			nonEmptyLineCount: countNonEmptyLines(content),
			contentHash: computeBlobHash(content),
			mtimeMs: options.mtimeMs ?? 0,
		},
		diagnostics,
	};
}

export function extractCognitionHeadings(content: string): CognitionHeading[] {
	return extractHeadings(content, 0);
}

function kindFromKey(key: string): CognitionDocumentKind {
	return key === '/' || key.endsWith('/') ? 'folder' : 'leaf';
}

function parseFrontmatter(content: string): FrontmatterParseResult {
	const lines = content.split(/\r?\n/u);
	const diagnostics: CognitionDocumentDiagnostic[] = [];

	if (lines[0]?.trim() !== '---') {
		return {
			frontmatter: EMPTY_FRONTMATTER,
			body: content,
			bodyLineOffset: 0,
			diagnostics: [
				{
					code: 'missing-frontmatter',
					severity: 'warning',
					message: 'Cognition document is missing YAML frontmatter.',
				},
			],
		};
	}

	const endLineIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
	if (endLineIndex === -1) {
		return {
			frontmatter: EMPTY_FRONTMATTER,
			body: content,
			bodyLineOffset: 0,
			diagnostics: [
				{
					code: 'malformed-frontmatter',
					severity: 'error',
					message: 'Cognition document frontmatter is not closed.',
				},
			],
		};
	}

	const frontmatterText = lines.slice(1, endLineIndex).join('\n');
	const body = lines.slice(endLineIndex + 1).join('\n');
	const doc = parseDocument(frontmatterText);

	if (doc.errors.length > 0) {
		return {
			frontmatter: EMPTY_FRONTMATTER,
			body,
			bodyLineOffset: endLineIndex + 1,
			diagnostics: [
				{
					code: 'malformed-frontmatter',
					severity: 'error',
					message: doc.errors[0]?.message ?? 'Cognition document frontmatter is malformed.',
				},
			],
		};
	}

	const rawValue = doc.toJSON();
	if (!isRecord(rawValue)) {
		return {
			frontmatter: EMPTY_FRONTMATTER,
			body,
			bodyLineOffset: endLineIndex + 1,
			diagnostics: [
				{
					code: 'malformed-frontmatter',
					severity: 'error',
					message: 'Cognition document frontmatter must be a mapping.',
				},
			],
		};
	}

	return {
		frontmatter: normalizeFrontmatter(rawValue),
		body,
		bodyLineOffset: endLineIndex + 1,
		diagnostics,
	};
}

function normalizeFrontmatter(raw: Record<string, unknown>): CognitionFrontmatter {
	const metadata = isRecord(raw.metadata)
		? normalizeMetadata(raw.metadata)
		: {};

	return {
		name: typeof raw.name === 'string' ? raw.name : null,
		description: typeof raw.description === 'string' ? raw.description : null,
		metadata,
		raw,
	};
}

function normalizeMetadata(raw: Record<string, unknown>): CognitionFrontmatterMetadata {
	const metadata: CognitionFrontmatterMetadata = { ...raw };

	if (isStringArray(raw.tags)) {
		metadata.tags = raw.tags;
	}
	if (isStringArray(raw.apiSurface)) {
		metadata.apiSurface = raw.apiSurface;
	}
	if (isRecord(raw.retrieval)) {
		metadata.retrieval = {
			...(typeof raw.retrieval.summary === 'string' ? { summary: raw.retrieval.summary } : {}),
			...(isStringArray(raw.retrieval.intents) ? { intents: raw.retrieval.intents } : {}),
		};
	}

	return metadata;
}

function validateFrontmatter(frontmatter: CognitionFrontmatter): CognitionDocumentDiagnostic[] {
	const diagnostics: CognitionDocumentDiagnostic[] = [];
	const rawMetadata = isRecord(frontmatter.raw.metadata)
		? frontmatter.raw.metadata
		: {};

	if (!frontmatter.name) {
		diagnostics.push({
			code: 'missing-name',
			severity: 'warning',
			message: 'Cognition document frontmatter is missing name.',
		});
	}
	if (!frontmatter.description) {
		diagnostics.push({
			code: 'missing-description',
			severity: 'warning',
			message: 'Cognition document frontmatter is missing description.',
		});
	} else if (isWeakDescription(frontmatter.description)) {
		diagnostics.push({
			code: 'weak-description',
			severity: 'info',
			message: 'Cognition document description looks like a placeholder or weak routing description.',
		});
	}
	if (typeof frontmatter.metadata.type !== 'string' || frontmatter.metadata.type.trim() === '') {
		diagnostics.push({
			code: 'missing-metadata-type',
			severity: 'warning',
			message: 'Cognition document metadata is missing type.',
		});
	}
	if ('tags' in rawMetadata && !isStringArray(rawMetadata.tags)) {
		diagnostics.push({
			code: 'invalid-metadata-tags',
			severity: 'warning',
			message: 'Cognition document metadata.tags must be an array of strings.',
		});
	}
	if ('apiSurface' in rawMetadata && !isStringArray(rawMetadata.apiSurface)) {
		diagnostics.push({
			code: 'invalid-metadata-api-surface',
			severity: 'warning',
			message: 'Cognition document metadata.apiSurface must be an array of strings.',
		});
	}
	if (
		isRecord(rawMetadata.retrieval)
		&& 'intents' in rawMetadata.retrieval
		&& !isStringArray(rawMetadata.retrieval.intents)
	) {
		diagnostics.push({
			code: 'invalid-metadata-retrieval-intents',
			severity: 'warning',
			message: 'Cognition document metadata.retrieval.intents must be an array of strings.',
		});
	}

	return diagnostics;
}

function extractHeadings(content: string, lineOffset: number): CognitionHeading[] {
	const headings: CognitionHeading[] = [];
	const lines = content.split(/\r?\n/u);
	let inFence = false;
	let fenceMarker: string | null = null;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const fence = line.match(/^\s*(`{3,}|~{3,})/u);
		if (fence) {
			const marker = fence[1][0];
			if (!inFence) {
				inFence = true;
				fenceMarker = marker;
			} else if (fenceMarker === marker) {
				inFence = false;
				fenceMarker = null;
			}
			continue;
		}

		if (inFence) {
			continue;
		}

		const heading = line.match(/^(#{1,6})[ \t]+(.+?)\s*#*\s*$/u);
		if (!heading) {
			continue;
		}

		const text = heading[2].trim();
		headings.push({
			depth: heading[1].length as CognitionHeading['depth'],
			text,
			line: lineOffset + index + 1,
			slug: slugifyHeading(text),
		});
	}

	return headings;
}

function slugifyHeading(text: string): string {
	return text
		.trim()
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
		.replace(/\s+/gu, '-')
		.replace(/-+/gu, '-')
		.replace(/^-|-$/gu, '');
}

function countLines(content: string): number {
	if (content.length === 0) {
		return 0;
	}
	return content.split(/\r?\n/u).length;
}

function countNonEmptyLines(content: string): number {
	return content
		.split(/\r?\n/u)
		.filter((line) => line.trim().length > 0)
		.length;
}

function isWeakDescription(description: string): boolean {
	const normalized = description.trim();
	if (normalized.length === 0) {
		return true;
	}
	return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
