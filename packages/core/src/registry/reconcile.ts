/**
 * Phase 3: Reconcile engine.
 *
 * Compares the on-disk cognition directory tree against the registry to produce
 * a diff of operations (add, delete, rename). Called at startup and after any
 * major structural change.
 *
 * ## Algorithm
 *
 * ```
 * Input:
 *   A = walk cognition dir → {key → {path, mtimeMs, contentHash, contentLength}}
 *   B = registry entries   → {key → entry}
 *
 * 1.  deleted  = keys(B) - keys(A)
 * 2.  added    = keys(A) - keys(B)
 * 3.  intersection = keys(A) ∩ keys(B)
 * ```
 *
 * Content hash pairing (rename detection):
 * - Exact SHA256 + contentLength match only
 * - Threshold: contentLength > MIN_RENAME_PAIRING_LENGTH (100)
 * - Greedy first-match in iteration order
 * - No multi-hop chasing (A→B→C → only B→C found; A metadata lost &mdash; by design)
 */

import type { FileSystem, UriComponents } from '../interfaces';
import { Registry } from './index';
import { computeBlobHash } from '../hash';
import { cognitionPathToKey, isTrackedCognitionFile, MIN_RENAME_PAIRING_LENGTH } from '../identity';
import type { PathKeyRecord } from '../types';
import { joinUriPath, uriRelativePath } from '../uri-utils';

// ─── Constants ──────────────────────────────────────────────────────────────

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Scan-specific info for a cognition file found on disk.
 *
 * NOT the same as `CognitionFileInfo` from types.ts — this type is purpose-built
 * for directory scanning and carries content-hash data for rename pairing.
 */
export interface CognitionFileScanInfo {
	/** Relative path from cognition root to the `.md` file */
	path: string;
	/** Last modification time in milliseconds */
	mtimeMs: number;
	/** SHA256 hex hash of file content */
	contentHash: string;
	/** Content length in characters */
	contentLength: number;
}

/** Result of scanning the cognition directory: registry key → scan info. */
export type CognitionDirScan = Map<string, CognitionFileScanInfo>;

/**
 * Result of a reconcile run.
 *
 * Describes every registry key's disposition after comparing on-disk cognition
 * files against the stored registry.
 */
export interface ReconcileDiff {
	/** Keys whose registry metadata migrated from one path to another (same content). */
	renamed: Array<{ from: string; to: string }>;
	/** Keys added to the registry (new cognition files with no prior entry). */
	added: string[];
	/** Keys removed from the registry (cognition file deleted, not a rename). */
	deleted: string[];
	/** Keys whose cognition content changed since the last reconcile. */
	updated: string[];
	/** Keys whose cognition content is unchanged since the last reconcile. */
	unchanged: string[];
	/** Summary counters. */
	stats: {
		totalScanned: number;
		totalRegistryEntries: number;
		renamePairsFound: number;
	};
}

// ─── Scan ───────────────────────────────────────────────────────────────────

/**
 * Walk the cognition directory tree recursively and collect structured info for
 * every `.md` file.
 *
 * - Computes registry keys via `cognitionPathToKey`
 * - Skips non-`.md` files and unreadable entries
 * - Reads file content and computes a SHA256 content hash via `computeBlobHash`
 *
 * @param fs               Platform filesystem abstraction
 * @param cognitionRootUri URI of the cognition root directory
 * @returns Map of registry key → cognition file scan info
 */
export async function scanCognitionDirectory(
	fs: FileSystem,
	cognitionRootUri: UriComponents,
): Promise<CognitionDirScan> {
	const result: CognitionDirScan = new Map();
	await walkDir(fs, cognitionRootUri, cognitionRootUri, result);
	return result;
}

/**
 * Recursively walk a directory, collecting `.md` file info into `result`.
 *
 * @param fs      Platform filesystem abstraction
 * @param rootUri The cognition root (used to compute relative paths)
 * @param dirUri  The current directory to walk
 * @param result  Accumulator map
 */
async function walkDir(
	fs: FileSystem,
	rootUri: UriComponents,
	dirUri: UriComponents,
	result: CognitionDirScan,
): Promise<void> {
	let entries: Array<[string, number]>;
	try {
		entries = await fs.readDirectory(dirUri);
	} catch {
		// Directory missing or unreadable — safe to skip
		return;
	}

	for (const [name, type] of entries) {
		const childUri = joinUriPath(dirUri, name);

		if (type & FILE_TYPE_DIRECTORY) {
			await walkDir(fs, rootUri, childUri, result);
			continue;
		}

		if (!(type & FILE_TYPE_FILE) || !name.endsWith('.md')) {
			continue;
		}

		const relativePath = uriRelativePath(rootUri, childUri);
		if (!relativePath) {
			continue;
		}

		// Free-form cognition documents (CODE_MAP.md, MODULES.md, etc.) are not
		// source-paired and do not participate in registry tracking.
		if (!isTrackedCognitionFile(relativePath)) {
			continue;
		}

		const [content, fileStat] = await safeReadFile(fs, childUri);
		if (content === null) {
			continue;
		}

		const key = cognitionPathToKey(relativePath);
		const contentHash = computeBlobHash(content);
		const contentLength = content.length;
		const mtimeMs = fileStat?.mtimeMs ?? 0;

		// Avoid overwriting entries that would produce duplicate keys (last file wins)
		result.set(key, {
			path: relativePath,
			mtimeMs,
			contentHash,
			contentLength,
		});
	}
}

/**
 * Safely read a file's content and stat, returning `null` for both on error.
 */
async function safeReadFile(
	fs: FileSystem,
	uri: UriComponents,
): Promise<[string | null, { mtimeMs: number } | null]> {
	try {
		const [content, stat] = await Promise.all([
			fs.readFile(uri),
			fs.stat(uri),
		]);
		return [content, stat ?? null];
	} catch {
		return [null, null];
	}
}

// ─── Rename detection ───────────────────────────────────────────────────────

/**
 * Pair deleted registry entries with newly discovered cognition files by exact
 * content hash + length matching.
 *
 * Rules:
 * - Skip added files whose `contentLength <= MIN_RENAME_PAIRING_LENGTH` (100)
 *   to avoid false-positive pairing on template/skeleton cognition files.
 * - Match requires BOTH content hash AND content length to be identical (SHA256
 *   is collision-resistant, but the spec requires exact hash + length).
 * - Greedy first-match: the first `added` entry whose hash matches a `deleted`
 *   entry claims the pair. The matched deleted entry is removed from the pool.
 * - **Chain rename limitation**: `A→B→C` — only `B→C` is detected; `A`'s
 *   metadata is lost. No multi-hop chasing is attempted.
 *
 * @param added   Cognition files on disk that have no registry entry
 * @param deleted Registry entries whose cognition files no longer exist on disk
 *                (only entries with non-null `cognitionBlobHash` should be passed)
 * @returns Detected rename pairs, first-match order
 */
export function pairDeletedToAdded(
	added: CognitionDirScan,
	deleted: Map<string, PathKeyRecord>,
): Array<{ from: string; to: string }> {
	const pairs: Array<{ from: string; to: string }> = [];
	const remainingDeleted = new Map(deleted);

	for (const [addKey, addInfo] of added) {
		if (addInfo.contentLength <= MIN_RENAME_PAIRING_LENGTH) {
			continue;
		}

		for (const [delKey, delEntry] of remainingDeleted) {
			if (
				delEntry.cognitionBlobHash !== null &&
				delEntry.cognitionLength !== null &&
				delEntry.cognitionBlobHash === addInfo.contentHash &&
				delEntry.cognitionLength === addInfo.contentLength
			) {
				pairs.push({ from: delKey, to: addKey });
				remainingDeleted.delete(delKey);
				break; // Greedy first-match
			}
		}
	}

	return pairs;
}

// ─── Reconcile orchestrator ─────────────────────────────────────────────────

/**
 * Infer the cognition type from a registry key.
 *
 * - Keys ending with `/` (or equal to `/`) represent folder README cognition.
 * - All other keys represent leaf-file cognition.
 */
function inferType(key: string): 'leaf' | 'folder' {
	return key === '/' || key.endsWith('/') ? 'folder' : 'leaf';
}

/**
 * Full reconcile algorithm — the main entry point for Phase 3.
 *
 * 1. Compute `deleted`, `added`, and `intersection` key sets
 * 2. Content-hash-pair deleted entries with added entries (rename detection)
 * 3. Apply operations to the registry:
 *    - `rename(from, to)` — all metadata migrates
 *    - `delete(key)` — true deletions (not paired as rename)
 *    - `add(key, info)` — minimal entry with cognition time and hash cache
 *    - `update(key, info)` — refresh hash cache if content changed
 * 4. Return a `ReconcileDiff` summarising the outcome
 *
 * @param registry   The in-memory registry (will be mutated and marked dirty)
 * @param scanResult On-disk cognition file scan from `scanCognitionDirectory`
 * @returns Diff describing what changed
 */
export async function reconcileRegistry(
	registry: Registry,
	scanResult: CognitionDirScan,
): Promise<ReconcileDiff> {
	const registryEntries = registry.getAllEntries();
	const registryKeys = new Set(Object.keys(registryEntries));
	const scanKeys = new Set(scanResult.keys());

	// ── Step 1: Set arithmetic ──────────────────────────────────────────────

	const deletedKeys: string[] = [];
	const addedKeys: string[] = [];
	const intersectionKeys: string[] = [];

	for (const key of registryKeys) {
		if (scanKeys.has(key)) {
			intersectionKeys.push(key);
		} else {
			deletedKeys.push(key);
		}
	}

	for (const key of scanKeys) {
		if (!registryKeys.has(key)) {
			addedKeys.push(key);
		}
	}

	// ── Step 2: Prepare maps for pairing ────────────────────────────────────

	// Only deleted entries with a cached cognition hash are pairing candidates
	const deletedWithHash = new Map<string, PathKeyRecord>();
	for (const key of deletedKeys) {
		const entry = registryEntries[key];
		if (entry && entry.cognitionBlobHash !== null && entry.cognitionLength !== null) {
			deletedWithHash.set(key, entry);
		}
	}

	// Only added entries that exist in the scan result are pairing candidates
	const addedMap: CognitionDirScan = new Map();
	for (const key of addedKeys) {
		const info = scanResult.get(key);
		if (info) {
			addedMap.set(key, info);
		}
	}

	// ── Step 3: Rename detection ────────────────────────────────────────────

	const renamePairs = pairDeletedToAdded(addedMap, deletedWithHash);
	const renamedFromSet = new Set(renamePairs.map((p) => p.from));
	const renamedToSet = new Set(renamePairs.map((p) => p.to));

	// ── Step 4: Apply operations ────────────────────────────────────────────

	// 4a — Renames: all metadata migrates
	for (const { from, to } of renamePairs) {
		const ok = registry.renameKey(from, to, 'reconcile.rename');
		if (!ok) {
			continue; // Defensive — `from` should always exist
		}

		const info = scanResult.get(to);
		const entry = registry.getEntry(to);
		if (info && entry) {
			// Populate hash cache on the renamed entry
			registry.setEntry(to, {
				...entry,
				cognitionBlobHash: info.contentHash,
				cognitionLength: info.contentLength,
			}, 'reconcile.rename.hash-cache');
		}
	}

	// 4b — True deletions (deleted but NOT paired as rename)
	const trueDeletions: string[] = [];
	for (const key of deletedKeys) {
		if (!renamedFromSet.has(key)) {
			registry.deleteEntry(key, 'reconcile.delete');
			trueDeletions.push(key);
		}
	}

	// 4c — True additions (added but NOT paired as rename)
	const trueAdditions: string[] = [];
	for (const key of addedKeys) {
		if (renamedToSet.has(key)) {
			continue;
		}

		const info = scanResult.get(key)!;
		registry.setEntry(key, {
			sourcePath: null,
			type: inferType(key),
			createdAt: new Date().toISOString(),
			accepted: null,
			cognitionBlobHash: info.contentHash,
			cognitionLength: info.contentLength,
		} satisfies PathKeyRecord, 'reconcile.add');
		trueAdditions.push(key);
	}

	// 4d — Intersection: detect updates, populate hash cache
	const updatedKeys: string[] = [];
	const unchangedKeys: string[] = [];

	for (const key of intersectionKeys) {
		const scanInfo = scanResult.get(key)!;
		const existingEntry = registryEntries[key];

		const hasPriorHash =
			existingEntry.cognitionBlobHash !== null &&
			existingEntry.cognitionLength !== null;

		const hashChanged =
			existingEntry.cognitionBlobHash !== scanInfo.contentHash ||
			existingEntry.cognitionLength !== scanInfo.contentLength;

		if (hasPriorHash && hashChanged) {
			// Cognition file content changed since last reconcile
			registry.setEntry(key, {
				...existingEntry,
				cognitionBlobHash: scanInfo.contentHash,
				cognitionLength: scanInfo.contentLength,
			}, 'reconcile.update');
			updatedKeys.push(key);
		} else {
			// Populate hash cache on first encounter (no prior hash)
			if (!hasPriorHash) {
				registry.setEntry(key, {
					...existingEntry,
					cognitionBlobHash: scanInfo.contentHash,
					cognitionLength: scanInfo.contentLength,
				}, 'reconcile.populate-hash-cache');
			}
			unchangedKeys.push(key);
		}
	}

	// ── Step 5: Build result ────────────────────────────────────────────────

	return {
		renamed: renamePairs,
		added: trueAdditions,
		deleted: trueDeletions,
		updated: updatedKeys,
		unchanged: unchangedKeys,
		stats: {
			totalScanned: scanResult.size,
			totalRegistryEntries: registryKeys.size,
			renamePairsFound: renamePairs.length,
		},
	};
}
