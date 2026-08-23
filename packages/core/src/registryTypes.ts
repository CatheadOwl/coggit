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
	/** ISO datetime of entry creation. @deprecated Removed from schema v6; retained only for old in-memory callers. */
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
	/** @deprecated Removed from schema v6; retained only for rename detection in-memory. */
	cognitionBlobHash?: string | null;
	/** @deprecated Removed from schema v6; retained only for rename detection in-memory. */
	cognitionLength?: number | null;
}

/** The on-disk registry file shape. */
export interface RegistryFile {
	schemaVersion: number;
	/** Human-facing note for agents and contributors inspecting this generated metadata. */
	maintenanceNotice?: string;
	entries: Record<string, PathKeyRecord>;
}

/** Optional provider that core can use to read/write registry data. */
export interface RegistryProvider {
	/** Load the full registry file. Returns null if no file exists or recovery failed. */
	load(): Promise<RegistryFile | null>;
	/** Atomically save the full registry file. */
	save(file: RegistryFile): Promise<void>;
}
