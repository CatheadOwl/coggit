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

export interface CoggitOperationAction {
	code: string;
	label: string;
	tool?: 'coggit_snapshot' | 'coggit_status' | 'coggit_add' | 'coggit_routes';
	sourcePath?: string;
	scope?: SnapshotOperationScope;
	maxDepth?: number;
}
