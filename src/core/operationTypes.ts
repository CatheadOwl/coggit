export type SnapshotOperationScope = 'tracked' | 'untracked' | 'issues' | 'all';

export interface CoggitProjectContext {
	label: string;
	configUri: string;
	projectRootUri: string;
	sourceRootUri: string;
	cognitionRootUri: string;
	/** Project-root-relative source root path, e.g. "codebase" - mirrors config.yaml source_root. */
	sourceRoot: string;
	/** Project-root-relative cognition root path, e.g. "codebase_cognition" - mirrors config.yaml cognition_root. */
	cognitionRoot: string;
	sourcePathRule: string;
}

/**
 * Surface-neutral operation vocabulary.
 *
 * Boundary rule for core hints: `suggestedActions`, `verify` hints, and any
 * other next-step guidance emitted by core may only reference these
 * operation ids and opaque asset ids (e.g. `handbookId`) — never adapter
 * tool names, CLI command names, or resource URIs. Each adapter owns the
 * mapping from an operation id to its own surface addressing (MCP maps to
 * its `coggit_*` tools, the CLI maps to subcommands, and so on).
 */
export const CORE_OPERATION_IDS = ['snapshot', 'status', 'add', 'resolve', 'routes'] as const;

export type CoreOperationId = typeof CORE_OPERATION_IDS[number];

/**
 * Surface-neutral re-inspection handle: how to actively re-check a source
 * path after a write (`operation: 'status'` + `sourcePath`). It is a data
 * handle, not workflow guidance. Next-step prose belongs to outcome-aware
 * hints (`suggestedActions`, `handbookId`, miss fields). Surfacing rule: a
 * non-miss failure may surface it, success is self-confirming, and a miss
 * surfaces `pathHints` instead.
 */
export interface CoggitOperationVerifyHint {
	operation: 'status';
	sourcePath: string;
}

export interface CoggitOperationAction {
	code: string;
	label: string;
	operation?: CoreOperationId;
	sourcePath?: string;
	scope?: SnapshotOperationScope;
	maxDepth?: number;
}
