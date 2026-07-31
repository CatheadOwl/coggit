import type { UriComponents, UriKey, WorkspaceFolderInfo } from './interfaces';
import type { NodeStatusResult, ObservedStatus } from './statusTypes';

export interface MisplacedCognitionEntry {
	registryKey: string;
	type: 'leaf' | 'folder';
	sourcePath: string;
	sourceUri: UriComponents;
	actualCognitionPath: string;
	actualCognitionUri: UriComponents;
	expectedCognitionPath: string;
	expectedCognitionUri: UriComponents;
}

export interface OrphanedCognitionEntry {
	registryKey: string;
	type: 'leaf' | 'folder';
	sourcePath: string;
	sourceUri: UriComponents;
	cognitionPath: string;
	cognitionUri: UriComponents;
}

export interface StrayCognitionEntry {
	registryKey: string;
	type: 'leaf' | 'folder';
	cognitionPath: string;
	cognitionUri: UriComponents;
	sourceCandidateUris: UriComponents[];
}

export type CoggitNodeKind = 'root' | 'folder' | 'file' | 'error';

export interface MappingIndex {
	/** Canonical URI identity key. */
	sourceToCognition: Map<UriKey, UriKey[]>;
	/** Canonical URI identity key. */
	cognitionToSource: Map<UriKey, UriKey>;
	structuralEdges: Array<{
		from: string;
		to: string;
		kind: 'parent' | 'child' | 'sibling';
	}>;
	semanticEdges: Array<{
		from: string;
		to: string;
		kind: 'link' | 'backlink';
	}>;
}

export interface AffectedResult {
	pairs: Array<{
		sourcePath: string;
		cognitionPath: string;
		reason: 'direct' | 'structural' | 'semantic';
	}>;
	stats: {
		direct: number;
		structural: number;
		semantic: number;
		total: number;
	};
}

export interface CoggitWorkspaceRoot {
	id: string;
	label: string;
	workspaceFolder: WorkspaceFolderInfo;
	configUri: UriComponents;
	projectRootUri: UriComponents;
	sourceRootUri: UriComponents;
	cognitionRootUri: UriComponents;
	error?: string;
}

export interface CoggitTreeNode {
	id: string;
	kind: CoggitNodeKind;
	label: string;
	resourceUri: UriComponents;
	sourceUri: UriComponents;
	cognitionUri?: UriComponents;
	relativePath: string;
	/** Own cognition/projection status for this node only, before descendant aggregation. */
	ownStatus?: NodeStatusResult;
	/** Aggregated status for this node plus descendants. */
	status?: NodeStatusResult;
	contextValue: string;
	parent?: CoggitTreeNode;
	children?: CoggitTreeNode[];
	description?: string;
	tooltip?: string;
	root: CoggitWorkspaceRoot;
	representativeMtimeMs?: number;
}

export interface CoggitSnapshot {
	roots: CoggitTreeNode[];
	allNodes: CoggitTreeNode[];
	nodeById: Map<string, CoggitTreeNode>;
	nodeBySourceUri: Map<string, CoggitTreeNode>;
	/** Mapping index used for incremental affected-path calculation. */
	mappingIndex?: MappingIndex;
}

export interface TreeProjectionNode {
	path: string;
	label: string;
	kind: CoggitNodeKind;
	cognition?: string;
	description?: string;
	observedStatus?: ObservedStatus | null;
	ownObservedStatus?: ObservedStatus | null;
	tracked?: boolean;
	children?: TreeProjectionNode[];
}

export interface CoggitConfig {
	sourceRoot: string;
	cognitionRoot: string;
}
