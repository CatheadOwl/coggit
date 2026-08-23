import type {
	AcceptedPair,
	PathKeyRecord,
	RegistryFile,
	RegistryProvider,
} from '../types';
import { createHash } from 'node:crypto';
import { debugLog, nullCoggitLogger, warnLog, type CoggitLogger } from '../logger';

export const REGISTRY_SCHEMA_VERSION = 6;
const PREVIOUS_SCHEMA_VERSION = 5;
export const REGISTRY_MAINTENANCE_NOTICE = 'This file is auto-maintained CogGit metadata. Ignore routine changes; it is committed so metadata can be located across hosts. Direct reads may be stale; use CogGit commands or MCP tools for authoritative freshness.';
const REGISTRY_TRACE_CATEGORY = 'registry.trace';

export interface RegistryCreateOptions {
	logger?: CoggitLogger;
}

/** Opaque revision of the complete registry file loaded by a Registry instance. */
export type RegistryRevision = string;

/**
 * Raised when a Registry instance tries to flush a file based on an obsolete
 * loaded revision. Callers must discard the instance, reload, and recompute.
 */
export class RegistryRevisionMismatchError extends Error {
	constructor(
		readonly expectedRevision: RegistryRevision,
		readonly actualRevision: RegistryRevision,
	) {
		super('CogGit registry changed since this instance was loaded. Reload before committing.');
		this.name = 'RegistryRevisionMismatchError';
	}
}

/**
 * In-memory metadata store backed by a provider (VSCode filesystem or in-memory).
 *
 * Manages CRUD over registry entries, dirty tracking, and atomic flush.
 * Core modules must NOT import this class directly -- only reference the
 * `RegistryProvider` interface from types.ts.
 */
export class Registry {
	private file: RegistryFile;
	private dirty: boolean;
	private provider: RegistryProvider;
	private logger: CoggitLogger;
	private revision: RegistryRevision;

	private constructor(
		provider: RegistryProvider,
		file: RegistryFile,
		logger: CoggitLogger = nullCoggitLogger,
		dirty = false,
		revision = computeRegistryRevision(file),
	) {
		this.provider = provider;
		this.file = file;
		this.logger = logger;
		this.dirty = dirty;
		this.revision = revision;
	}

	// ─── Factory ──────────────────────────────────────────────────────────────────

	/**
	 * Create a Registry instance backed by the given provider.
	 *
	 * - If the provider has stored data, it is loaded and validated.
	 * - Schema version mismatch triggers a clean rebuild (not a crash).
	 * - If no stored data exists, an empty registry is created.
	 */
	static async create(
		provider: RegistryProvider,
		options: RegistryCreateOptions = {},
	): Promise<Registry> {
		const loaded = await provider.load();
		const logger = options.logger ?? nullCoggitLogger;

		if (loaded === null) {
			return new Registry(
				provider,
				createEmptyRegistryFile(),
				logger,
				false,
				computeRegistryRevision(null),
			);
		}

		// Schema version mismatch -- v5→v6 semantic migration or clean rebuild
		if (loaded.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
			if (loaded.schemaVersion === PREVIOUS_SCHEMA_VERSION) {
				warnLog(logger, 'registry.io', 'Migrating registry from v5 to v6', {
					actualSchemaVersion: loaded.schemaVersion,
					expectedSchemaVersion: REGISTRY_SCHEMA_VERSION,
				});
				const migrated = migrateV5ToV6(loaded);
				return new Registry(provider, migrated, logger, true, computeRegistryRevision(loaded));
			}
			warnLog(logger, 'registry.io', 'Registry schema version mismatch; rebuilding', {
				actualSchemaVersion: loaded.schemaVersion,
				expectedSchemaVersion: REGISTRY_SCHEMA_VERSION,
			});
			return new Registry(
				provider,
				createEmptyRegistryFile(),
				logger,
				false,
				computeRegistryRevision(loaded),
			);
		}

		const { file, changed } = normalizeRegistryFile(loaded);
		return new Registry(provider, file, logger, changed, computeRegistryRevision(loaded));
	}

	// ─── Read methods ─────────────────────────────────────────────────────────────

	/** Get a single entry by key, or undefined if not found. */
	getEntry(key: string): PathKeyRecord | undefined {
		return this.file.entries[key];
	}

	/** Check whether an entry exists for the given key. */
	hasEntry(key: string): boolean {
		return key in this.file.entries;
	}

	/** Get a shallow clone of all entries (prevents external mutation of the internal map). */
	getAllEntries(): Record<string, PathKeyRecord> {
		return { ...this.file.entries };
	}

	/** Find all entries that reference the given source path. */
	getEntriesBySourcePath(sourcePath: string): PathKeyRecord[] {
		return this.getRecordsBySourcePath(sourcePath).map((match) => match.record);
	}

	/** Find all path-keyed records that reference the given source path. */
	getRecordsBySourcePath(sourcePath: string): Array<{ key: string; record: PathKeyRecord }> {
		return Object.entries(this.file.entries)
			.filter(([, entry]) => entry.sourcePath === sourcePath)
			.map(([key, record]) => ({ key, record }));
	}

	/** Find all registry keys that reference the given source path. */
	getKeysBySourcePath(sourcePath: string): string[] {
		return Object.entries(this.file.entries)
			.filter(([, entry]) => entry.sourcePath === sourcePath)
			.map(([key]) => key);
	}

	/** Get all registry keys. */
	getKeys(): string[] {
		return Object.keys(this.file.entries);
	}

	/** Read the complete accepted source/cognition relationship. */
	getAcceptedPair(key: string): AcceptedPair | null {
		return this.file.entries[key]?.accepted ?? null;
	}

	/** @deprecated Legacy in-memory accessor; v5 freshness uses getAcceptedPair. */
	getFreshnessTimes(key: string) {
		const entry = this.file.entries[key];
		return {
			sourceFactMtimeMs: entry?.sourceFactMtimeMs ?? null,
			cognitionMtimeMs: entry?.cognitionMtimeMs ?? null,
			verificationTimeMs: entry?.verificationTimeMs ?? null,
			sourceFactHash: entry?.sourceFactHash ?? null,
		};
	}

	// ─── Write methods ────────────────────────────────────────────────────────────

	/** Add or overwrite an entry at the given key. Marks the registry dirty. */
	setEntry(key: string, entry: PathKeyRecord, source = 'registry.setEntry'): void {
		const previous = this.file.entries[key];
		this.file.entries[key] = entry;
		this.dirty = true;
		this.traceSetEntry(key, previous, entry, source);
	}

	/** Remove an entry by key. Marks the registry dirty. No-op if the key does not exist. */
	deleteEntry(key: string, source = 'registry.deleteEntry'): void {
		if (key in this.file.entries) {
			const previous = this.file.entries[key];
			delete this.file.entries[key];
			this.dirty = true;
			this.traceRegistryMutation('entry-delete', source, {
				key,
				oldSourcePath: previous.sourcePath,
			});
		}
	}

	/**
	 * Move an entry from oldKey to newKey, preserving all entry fields.
	 *
	 * Sets dirty once (not delete+set as two separate operations).
	 *
	 * @returns true if the rename succeeded, false if oldKey did not exist.
	 */
	renameKey(oldKey: string, newKey: string, source = 'registry.renameKey'): boolean {
		if (!(oldKey in this.file.entries)) {
			return false;
		}

		if (oldKey === newKey) {
			return true; // No-op, still logically successful
		}

		const entry = this.file.entries[oldKey];
		const overwritten = this.file.entries[newKey];
		this.file.entries[newKey] = entry;
		delete this.file.entries[oldKey];
		this.dirty = true;
		this.traceRegistryMutation('key-rename', source, {
			oldKey,
			newKey,
			oldSourcePath: overwritten?.sourcePath ?? null,
			newSourcePath: entry.sourcePath,
		});
		return true;
	}

	/** Replace the complete accepted relationship atomically in memory. */
	recordAcceptance(key: string, pair: AcceptedPair): void {
		const entry = this.file.entries[key];
		if (!entry) {
			return;
		}
		entry.accepted = pair;
		this.dirty = true;
	}

	/** @deprecated Legacy observation API; not used by v5 runtime. */
	recordSourceFactTime(key: string, mtimeMs: number, sourceFactHash?: string | null): void {
		const entry = this.file.entries[key];
		if (!entry) { return; }
		entry.sourceFactMtimeMs = mtimeMs;
		if (sourceFactHash !== undefined) { entry.sourceFactHash = sourceFactHash; }
		this.dirty = true;
	}

	/** @deprecated Legacy observation API; not used by v5 runtime. */
	recordCognitionTime(key: string, mtimeMs: number, contentHash?: string | null, contentLength?: number | null): void {
		const entry = this.file.entries[key];
		if (!entry) { return; }
		entry.cognitionMtimeMs = mtimeMs;
		if (contentHash !== undefined) { entry.cognitionBlobHash = contentHash; }
		if (contentLength !== undefined) { entry.cognitionLength = contentLength; }
		this.dirty = true;
	}

	/** @deprecated Legacy verification API; use recordAcceptance. */
	recordExplicitVerification(key: string, verificationTimeMs = Date.now()): void {
		const entry = this.file.entries[key];
		if (!entry) { return; }
		entry.verificationTimeMs = verificationTimeMs;
		this.dirty = true;
	}

	// ─── Flush / save ────────────────────────────────────────────────────────────

	/**
	 * Flush in-memory state to the provider.
	 *
	 * No-op if the registry has not been modified since the last flush.
	 */
	async flush(): Promise<void> {
		if (!this.dirty) {
			return;
		}

		const current = await this.provider.load();
		const actualRevision = computeRegistryRevision(current);
		if (actualRevision !== this.revision) {
			throw new RegistryRevisionMismatchError(this.revision, actualRevision);
		}

		const normalized = normalizeRegistryFile(this.file).file;
		this.file = normalized;
		await this.provider.save(normalized);
		this.revision = computeRegistryRevision(normalized);
		this.dirty = false;
	}

	/** Convenience: record an acceptance and flush immediately. */
	async flushAcceptance(key: string, pair: AcceptedPair): Promise<void> {
		this.recordAcceptance(key, pair);
		await this.flush();
	}

	private traceSetEntry(
		key: string,
		previous: PathKeyRecord | undefined,
		next: PathKeyRecord,
		source: string,
	): void {
		if (!previous) {
			this.traceRegistryMutation('entry-add', source, {
				key,
				newSourcePath: next.sourcePath,
			});
			return;
		}

		if (previous.sourcePath !== next.sourcePath) {
			this.traceRegistryMutation('sourcePath-change', source, {
				key,
				oldSourcePath: previous.sourcePath,
				newSourcePath: next.sourcePath,
			});
		}
	}

	private traceRegistryMutation(
		action: string,
		source: string,
		data: Record<string, unknown>,
	): void {
		debugLog(this.logger, REGISTRY_TRACE_CATEGORY, action, {
			action,
			source,
			...data,
		});
	}
}

function createEmptyRegistryFile(): RegistryFile {
	return {
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		maintenanceNotice: REGISTRY_MAINTENANCE_NOTICE,
		entries: {},
	};
}

function migrateV5ToV6(loaded: RegistryFile): RegistryFile {
	const entries: Record<string, PathKeyRecord> = {};
	for (const [key, entry] of Object.entries(loaded.entries)) {
		entries[key] = {
			sourcePath: entry.sourcePath ?? null,
			type: entry.type,
			accepted: normalizeAcceptedPair(entry.accepted),
		};
	}
	return {
		schemaVersion: REGISTRY_SCHEMA_VERSION,
		maintenanceNotice: loaded.maintenanceNotice ?? REGISTRY_MAINTENANCE_NOTICE,
		entries,
	};
}

function normalizeRegistryFile(file: RegistryFile): { file: RegistryFile; changed: boolean } {
	const entries = normalizeRegistryEntries(file.entries);
	const entriesChanged = JSON.stringify(entries) !== JSON.stringify(file.entries);
	return {
		file: {
			schemaVersion: file.schemaVersion,
			maintenanceNotice: REGISTRY_MAINTENANCE_NOTICE,
			entries,
		},
		changed: file.maintenanceNotice !== REGISTRY_MAINTENANCE_NOTICE || entriesChanged,
	};
}

function normalizeRegistryEntries(
	entries: Record<string, PathKeyRecord>,
): Record<string, PathKeyRecord> {
	return Object.fromEntries(
		Object.entries(entries).map(([key, entry]) => [key, normalizePathKeyRecord(entry)]),
	);
}

function normalizePathKeyRecord(entry: PathKeyRecord): PathKeyRecord {
	return {
		sourcePath: entry.sourcePath ?? null,
		type: entry.type,
		accepted: normalizeAcceptedPair(entry.accepted),
	};
}

/**
 * Compute a deterministic witness for the complete loaded file.
 *
 * This is intentionally not persisted and is not a freshness identity. It is
 * only used to reject stale full-file writes within the local commit boundary.
 */
export function computeRegistryRevision(file: RegistryFile | null): RegistryRevision {
	return createHash('sha256')
		.update(stableSerialize(file), 'utf8')
		.digest('hex');
}

function stableSerialize(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
	}
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record).sort().map((key) =>
		`${JSON.stringify(key)}:${stableSerialize(record[key])}`,
	).join(',')}}`;
}

function normalizeAcceptedPair(value: PathKeyRecord['accepted']): AcceptedPair | null {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const source = (value as AcceptedPair).source;
	const cognition = (value as AcceptedPair).cognition;
	if (!isIdentity(source) || !isIdentity(cognition)) {
		return null;
	}
	return { source, cognition };
}

function isIdentity(value: unknown): value is AcceptedPair['source'] {
	return typeof value === 'string' && /^sha256:v1:[0-9a-f]{64}$/u.test(value);
}
