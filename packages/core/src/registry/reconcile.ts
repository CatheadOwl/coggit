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
 *   A = walk cognition dir → set of registry keys (existence only)
 *   B = registry entries   → {key → entry}
 *
 * 1.  deleted  = keys(B) - keys(A)
 * 2.  added    = keys(A) - keys(B)
 * ```
 */

import type { FileSystem, UriComponents } from '../interfaces';
import { Registry } from './index';
import { discoverCognitionEntries } from '../cognition/cognitionDiscovery';
import type { PathKeyRecord } from '../types';

/** Result of scanning the cognition directory: the set of registry keys on disk. */
export type CognitionDirScan = ReadonlySet<string>;

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
 * Walk the cognition directory tree and collect the registry keys of every
 * source-paired cognition file present on disk.
 *
 * Existence-only: keys derive from directory listings through the shared
 * discovery layer (`cognitionPathToKey` conventions); file content is never
 * read and no content hash is computed — reconcile decisions consume the key
 * set alone.
 *
 * @param fs               Platform filesystem abstraction
 * @param cognitionRootUri URI of the cognition root directory
 * @returns Set of registry keys found on disk
 */
export async function scanCognitionDirectory(
	fs: FileSystem,
	cognitionRootUri: UriComponents,
): Promise<CognitionDirScan> {
	const keys = new Set<string>();
	const discovery = await discoverCognitionEntries(fs, cognitionRootUri);

	for (const entry of discovery.values()) {
		// Duplicate keys collapse into one membership (degenerate case; should
		// not occur with correct `cognitionPathToKey` mappings)
		keys.add(entry.registryKey);
	}

	return keys;
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
 * @param scanKeys   On-disk cognition key scan from `scanCognitionDirectory`
 * @returns Diff describing what changed
 */
export async function reconcileRegistry(
	registry: Registry,
	scanKeys: CognitionDirScan,
): Promise<ReconcileDiff> {
	const registryKeys = new Set(Object.keys(registry.getAllEntries()));

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
			totalScanned: scanKeys.size,
			totalRegistryEntries: registryKeys.size,
		},
	};
}
