export type SnapshotOperationScope = 'tracked' | 'untracked' | 'issues' | 'all';

export interface CoggitProjectContext {
	label: string;
	configUri: string;
	/**
	 * The consumer anchor: every project-root-relative path on the operation-DTO
	 * surface resolves against this URI. `sourceRootUri` / `cognitionRootUri`
	 * are internal and intentionally absent.
	 */
	projectRootUri: string;
	/** Project-root-relative source root path, e.g. "codebase" - mirrors config.yaml source_root. */
	sourceRoot: string;
	/** Project-root-relative cognition root path, e.g. "codebase_cognition" - mirrors config.yaml cognition_root. */
	cognitionRoot: string;
	sourcePathRule: string;
}

/**
 * Surface-neutral operation vocabulary.
 *
 * Boundary rule for core hints: `suggestedActions` and any other next-step
 * guidance emitted by core may only reference these operation ids and opaque
 * asset ids (e.g. `handbookId`) — never adapter tool names, CLI command
 * names, or resource URIs. Each adapter owns the mapping from an operation id
 * to its own surface addressing (MCP maps to its `coggit_*` tools, the CLI
 * maps to subcommands, and so on).
 */
export const CORE_OPERATION_IDS = ['snapshot', 'status', 'add', 'resolve', 'routes'] as const;

export type CoreOperationId = typeof CORE_OPERATION_IDS[number];

export interface CoggitOperationAction {
	code: string;
	label: string;
	operation?: CoreOperationId;
	/**
	 * Read-before-edit asset reference for authoring steps (e.g. the stale
	 * sync step). Same opaque id as the top-level `StatusOperationResult
	 * .handbookId`; adapters map it to their skill/resource address exactly as
	 * they map the top-level field. An action carrying `handbookId` is
	 * structured (adapter-mappable) even without an `operation`.
	 */
	handbookId?: 'leaf' | 'skeleton';
	/** Project-root-relative source path (the same coordinate as operation `sourcePath` inputs). */
	sourcePath?: string;
	scope?: SnapshotOperationScope;
	maxDepth?: number;
}
