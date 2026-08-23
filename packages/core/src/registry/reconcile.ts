/**
 * Phase 3: Reconcile engine.
 *
 * Compares the on-disk cognition directory tree against the registry to produce
 * a diff of operations (add, delete). Called at startup and after any
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
 * ```
 */

import type { FileSystem, UriComponents } from '../interfaces';
import { Registry } from './index';
import { computeBlobHash } from '../hash';
import { cognitionPathToKey, isTrackedCognitionFile } from '../identity';
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
 * for directory scanning and carries content-hash data for scan diagnostics.
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
	/** Keys added to the registry (new cognition files with no prior entry). */
	added: string[];
	/** Keys removed from the registry (cognition file deleted). */
	deleted: string[];
	/** Summary counters. */
	stats: {
		totalScanned: number;
		totalRegistryEntries: number;
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
 * 1. Compute `deleted` and `added` key sets
 * 2. Apply operations to the registry:
 *    - `delete(key)` — cognition file no longer exists
 *    - `add(key, info)` — new cognition file discovered
 * 3. Return a `ReconcileDiff` summarising the structural outcome
 *
 * @param registry   The in-memory registry (will be mutated and marked dirty)
 * @param scanResult On-disk cognition file scan from `scanCognitionDirectory`
 * @returns Diff describing what changed
 */
export async function reconcileRegistry(
	registry: Registry,
	scanResult: CognitionDirScan,
): Promise<ReconcileDiff> {
	const registryKeys = new Set(Object.keys(registry.getAllEntries()));
	const scanKeys = new Set(scanResult.keys());

	// ── Step 1: Set arithmetic ──────────────────────────────────────────────

	const deletedKeys: string[] = [];
	const addedKeys: string[] = [];

	for (const key of registryKeys) {
		if (!scanKeys.has(key)) {
			deletedKeys.push(key);
		}
	}

	for (const key of scanKeys) {
		if (!registryKeys.has(key)) {
			addedKeys.push(key);
		}
	}

	// ── Step 2: Apply operations ────────────────────────────────────────────

	for (const key of deletedKeys) {
		registry.deleteEntry(key, 'reconcile.delete');
	}

	for (const key of addedKeys) {
		registry.setEntry(key, {
			sourcePath: null,
			type: inferType(key),
			accepted: null,
		} satisfies PathKeyRecord, 'reconcile.add');
	}

	// ── Step 3: Build result ────────────────────────────────────────────────

	return {
		added: addedKeys,
		deleted: deletedKeys,
		stats: {
			totalScanned: scanResult.size,
			totalRegistryEntries: registryKeys.size,
		},
	};
}
