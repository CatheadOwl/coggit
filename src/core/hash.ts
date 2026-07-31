import { createHash } from 'node:crypto';

import type { SourceFactKind } from './statusTypes';

export type ContentIdentity = `sha256:v1:${string}`;

const IDENTITY_HEX_LENGTH = 64;

/** Compute the legacy unprefixed SHA-256 used by reconcile rename caches. */

export function computeBlobHash(content: string): string {
	return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Compute the versioned CogGit identity used by freshness acceptance.
 * Domain separation prevents the same bytes in different fact kinds from
 * accidentally sharing an identity.
 */
export function computeContentIdentity(
	kind: 'leaf' | 'cognition' | 'folder',
	content: string,
): ContentIdentity {
	const digest = createHash('sha256')
		.update(`coggit:${kind}:v1\0`, 'ascii')
		.update(content, 'utf8')
		.digest('hex');
	return `sha256:v1:${digest}`;
}

export function computeSourceFactIdentity(
	kind: SourceFactKind,
	content: string,
): ContentIdentity {
	return computeContentIdentity(kind === 'directory-entry' ? 'folder' : 'leaf', content);
}

export function computeCognitionIdentity(content: string): ContentIdentity {
	return computeContentIdentity('cognition', content);
}

export function isContentIdentity(value: unknown): value is ContentIdentity {
	return typeof value === 'string'
		&& /^sha256:v1:[0-9a-f]{64}$/u.test(value)
		&& value.length === 'sha256:v1:'.length + IDENTITY_HEX_LENGTH;
}
