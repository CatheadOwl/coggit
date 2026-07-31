/**
 * Shared types barrel re-export.
 * All types are defined in core/types.ts as a single source; other layers import through this file.
 */
export type {
	CoggitNodeKind,
	CoggitWorkspaceRoot,
	CoggitTreeNode,
	CoggitSnapshot,
	CoggitConfig,
} from '../core/types';
