/**
 * Pure path/URI-to-key conversion functions for the CogGit registry.
 *
 * Registry keys are cognition-root-derived identities used in
 * .coggit/registry.json. They are path-shaped keys, not general source paths.
 * Registry keys are cognition-root-derived identities. Path anchors are
 * specified in the registry path contract spec.
 * No IO, no state -- just string transformations.
 */

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

	const withoutMd = normalized.slice(0, -'.md'.length);

	if (withoutMd === '') {
		return '/';
	}

	const lastSegment = withoutMd.split('/').pop()!;
	if (lastSegment === 'README') {
		if (withoutMd === 'README') {
			return '/';
		}
		// Strip "/README" from end, append "/" to mark as folder key
		return withoutMd.slice(0, withoutMd.length - '/README'.length) + '/';
	}

	return withoutMd;
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
	const normalized = relativePath.replace(/\\/g, '/');
	const basename = normalized.split('/').pop() ?? normalized;

	// README.md → folder cognition, always tracked
	if (basename === 'README.md') {
		return true;
	}

	// Strip trailing .md and check if the remaining basename contains a dot
	// (indicating a source-like extension, e.g. "types.ts.md" → "types.ts")
	const withoutMd = basename.slice(0, -'.md'.length);
	return withoutMd.includes('.');
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
		return key + '.md';
	}

	// kind === 'folder'
	if (key === '/') {
		return 'README.md';
	}

	const normalized = key.endsWith('/') ? key : key + '/';
	return normalized + 'README.md';
}
