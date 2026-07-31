import type { FileSystem, UriComponents } from './interfaces';
import { dirname } from './path-utils';
import { joinUriPath } from './uri-utils';

/**
 * Result of a successful `findProjectRoot` call.
 *
 * `configUri` points to the `.coggit/config.yaml` that was found.
 * `projectRootUri` is the directory containing the `.coggit/` folder
 * (i.e. `dirname(dirname(configUri.path))`).
 *
 * Callers that need `sourceRootUri`/`cognitionRootUri` should parse
 * the YAML at `configUri` and resolve relative paths from `projectRootUri`.
 */
export interface ProjectRoot {
	configUri: UriComponents;
	projectRootUri: UriComponents;
}

const DEFAULT_MAX_WALK_DEPTH = 20;

/**
 * Walk up from `startUri` to find the nearest enclosing `.coggit/config.yaml`.
 *
 * Analogous to Git's `rev-parse --git-dir` — a lightweight path-anchoring
 * primitive that discovers which coggit project a file or directory belongs to.
 *
 * Core-layer function: depends only on `FileSystem` and `UriComponents`.
 * No host runtime (VS Code / Node) dependency.
 *
 * @param startUri  The URI to start from (file or directory).
 * @param fs        The FileSystem abstraction for existence checks.
 * @param options   Optional `{ maxWalkDepth }` to limit the upward walk.
 * @returns The `ProjectRoot` if found, or `undefined` if the walk exhausted.
 */
export async function findProjectRoot(
	startUri: UriComponents,
	fs: FileSystem,
	options?: { maxWalkDepth?: number },
): Promise<ProjectRoot | undefined> {
	const maxDepth = options?.maxWalkDepth ?? DEFAULT_MAX_WALK_DEPTH;

	// Start from the parent directory: if startUri is a file, go up one;
	// if it's already a directory (ends with /), use it directly.
	let current = startUri.path.endsWith('/')
		? startUri
		: { ...startUri, path: dirname(startUri.path) };

	for (let i = 0; i < maxDepth; i++) {
		// If the current directory itself is named ".coggit", skip it and
		// walk up — we never want to match a config file from inside its
		// own `.coggit/` directory.
		if (isDotCoggitDir(current.path)) {
			const parent = dirname(current.path);
			if (parent === current.path) { break; }
			current = { ...current, path: parent };
			continue;
		}

		const configUri = joinUriPath(current, '.coggit', 'config.yaml');
		const exists = await fs.exists(configUri);
		if (exists) {
			return { configUri, projectRootUri: current };
		}

		const parent = dirname(current.path);
		if (parent === current.path) { break; }
		current = { ...current, path: parent };
	}

	return undefined;
}

/** Check whether a filesystem path refers to a directory named `.coggit`. */
function isDotCoggitDir(path: string): boolean {
	const normalised = path.replace(/\\/g, '/').replace(/\/+$/, '');
	const idx = normalised.lastIndexOf('/');
	const basename = idx >= 0 ? normalised.slice(idx + 1) : normalised;
	return basename === '.coggit';
}
