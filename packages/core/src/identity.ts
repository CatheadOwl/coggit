/**
 * Pure path/URI-to-key conversion functions for the CogGit registry.
 *
 * Registry keys are cognition-root-derived identities used in
 * .coggit/registry.json. They are path-shaped keys, not general source paths.
 * Path anchors are specified in the registry path contract spec.
 * No IO, no state -- just string transformations.
 *
 * The `.md`/`README` source↔cognition pairing convention lives in `mapping.ts`
 * (`sourceIdentityToCognitionIdentity` / `cognitionIdentityToSourceIdentity`);
 * this module reuses it for key derivation rather than re-deriving it.
 */

import {
  cognitionIdentityToSourceIdentity,
  sourceIdentityToCognitionIdentity,
} from './mapping';

/** Minimum content length (in chars) for rename pairing to avoid false positives on empty template skeletons. */
export const MIN_RENAME_PAIRING_LENGTH = 100;

/**
 * Transform a source-relative path (with extension) to a registry key.
 *
 * Rules:
 * - Strip the file extension (last `.` onwards)
 * - Normalize separators to `/`
 * - Keep dotfiles' dot in the name (`.eslintrc.js` -> `.eslintrc`)
 *
 * @example sourcePathToKey("src/model/types.ts")       // -> "src/model/types"
 * @example sourcePathToKey("src/utils/helpers.js")     // -> "src/utils/helpers"
 * @example sourcePathToKey("src/index.ts")             // -> "src/index"
 * @example sourcePathToKey("foo.ts.md")                // -> "foo.ts"
 * @example sourcePathToKey(".eslintrc.js")             // -> ".eslintrc"
 * @example sourcePathToKey("noext")                    // -> "noext"
 * @example sourcePathToKey(".hidden")                  // -> ".hidden"
 */
export function sourcePathToKey(relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, '/');
	const lastSegment = normalized.split('/').pop() ?? normalized;
	if (/^\.+$/u.test(lastSegment)) {
		return normalized;
	}

	const dotIdx = normalized.lastIndexOf('.');

	// No dot, or leading dot (hidden file) -- no extension to strip
	if (dotIdx <= 0) {
		return normalized;
	}

	return normalized.slice(0, dotIdx);
}

/**
 * Transform a cognition-relative path (`.md` file) to a registry key.
 *
 * Rules:
 * - Strip trailing `.md`
 * - If remaining path is `"README"` (leaf name is README) -> return `"<parent-dir>/"`
 *   (trailing slash = folder key)
 * - If remaining path is `""` -> return `"/"` (root key)
 *
 * @example cognitionPathToKey("src/model/types.ts.md") // -> "src/model/types.ts"
 * @example cognitionPathToKey("src/README.md")          // -> "src/"
 * @example cognitionPathToKey("README.md")              // -> "/"
 */
export function cognitionPathToKey(relativePath: string): string {
	const normalized = relativePath.replace(/\\/g, '/');

	if (!normalized.endsWith('.md')) {
		throw new Error(`cognitionPathToKey: path must end with .md, got "${normalized}"`);
	}

	const mapped = cognitionIdentityToSourceIdentity(normalized);
	if (!mapped) {
		// Free-form document (e.g. `CODE_MAP.md`): key is the `.md`-stripped path.
		return normalized.slice(0, -'.md'.length);
	}
	if (mapped.kind === 'leaf') {
		return mapped.sourceIdentity;
	}
	return mapped.sourceIdentity === '.' ? '/' : `${mapped.sourceIdentity}/`;
}

/**
 * Determine whether a cognition file participates in registry tracking.
 *
 * Tracked cognition files have a source-pairing convention:
 * - `README.md` at any depth maps to a folder → tracked
 * - `<name>.<ext>.md` (basename contains a source-like extension before `.md`) → tracked
 *
 * Free-form cognition documents (CODE_MAP.md, MODULES.md, INDEX.md, etc.) do NOT
 * map to a specific source node and are excluded from registry tracking.
 *
 * @param relativePath Cognition-root-relative path (e.g. "src/CODE_MAP.md")
 *
 * @example isTrackedCognitionFile("README.md")              // true
 * @example isTrackedCognitionFile("src/README.md")          // true
 * @example isTrackedCognitionFile("src/types.ts.md")        // true
 * @example isTrackedCognitionFile("src/CODE_MAP.md")        // false
 * @example isTrackedCognitionFile("src/core/MODULES.md")    // false
 */
export function isTrackedCognitionFile(relativePath: string): boolean {
	return cognitionIdentityToSourceIdentity(relativePath) !== undefined;
}

/**
 * Build the cognition-relative path from a registry key.
 *
 * @param key  - Registry key (e.g. "src/model/types", "src/", "/")
 * @param kind - "leaf" for individual file cognition, "folder" for folder README cognition
 *
 * @example keyToCognitionPath("src/model/types", "leaf")   // -> "src/model/types.md"
 * @example keyToCognitionPath("src/model/types", "folder") // -> "src/model/types/README.md"
 * @example keyToCognitionPath("src/", "folder")            // -> "src/README.md"
 * @example keyToCognitionPath("/", "folder")               // -> "README.md"
 */
export function keyToCognitionPath(key: string, kind: 'leaf' | 'folder'): string {
	if (kind === 'leaf') {
		return `${key}.md`;
	}
	return sourceIdentityToCognitionIdentity(key === '/' ? '.' : key.replace(/\/+$/u, ''), 'folder');
}
