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
import { discoverCognitionEntries } from '../cognitionDiscovery';
import { computeBlobHash } from '../hash';
import type { PathKeyRecord } from '../types';

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
 * every source-paired cognition file.
 *
 * - Computes registry keys via `cognitionPathToKey`
 * - Skips free-form markdown, non-`.md` files, and unreadable entries
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
	const discovery = await discoverCognitionEntries(fs, cognitionRootUri);

	for (const entry of discovery.values()) {
		const [content, fileStat] = await safeReadFile(fs, entry.cognitionUri);
		if (content === null) {
			continue;
		}

		const contentHash = computeBlobHash(content);
		const contentLength = content.length;
		const mtimeMs = fileStat?.mtimeMs ?? 0;

		// Avoid overwriting entries that would produce duplicate keys (last file wins)
		result.set(entry.registryKey, {
			path: entry.cognitionPath,
			mtimeMs,
			contentHash,
			contentLength,
		});
	}

	return result;
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
