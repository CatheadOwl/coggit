import type { ContentIdentity } from './hash';

export interface AcceptedPair {
	source: ContentIdentity;
	cognition: ContentIdentity;
}

/** A single path-keyed record in .coggit/registry.json. */
export interface PathKeyRecord {
	/** Source file or folder path, relative to project root. */
	sourcePath: string | null;
	/** Cognition type, matching config template definition. */
	type: 'leaf' | 'folder';
	/** ISO datetime of entry creation. */
	createdAt?: string | null;
	/** Accepted source/cognition provenance relationship. */
	accepted?: AcceptedPair | null;
	/** @deprecated Removed from schema v5; retained only for old in-memory callers. */
	sourceFactMtimeMs?: number | null;
	/** @deprecated Removed from schema v5; retained only for old in-memory callers. */
	cognitionMtimeMs?: number | null;
	/** @deprecated Removed from schema v5; retained only for old in-memory callers. */
	verificationTimeMs?: number | null;
	/** @deprecated Removed from schema v5; retained only for old in-memory callers. */
	sourceFactHash?: string | null;
	/** SHA256 hex hash of cognition file content, cached for rename detection across reconcile runs. */
	cognitionBlobHash?: string | null;
	/** Content length in characters, cached for rename detection across reconcile runs. */
	cognitionLength?: number | null;
}

/** The on-disk registry file shape. */
export interface RegistryFile {
	schemaVersion: number;
	/** Human-facing note for agents and contributors inspecting this generated metadata. */
	maintenanceNotice?: string;
	updatedAt: string;
	entries: Record<string, PathKeyRecord>;
}

/** Optional provider that core can use to read/write registry data. */
export interface RegistryProvider {
	/** Load the full registry file. Returns null if no file exists or recovery failed. */
	load(): Promise<RegistryFile | null>;
	/** Atomically save the full registry file. */
	save(file: RegistryFile): Promise<void>;
}
