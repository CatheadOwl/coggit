/**
 * Shared types barrel re-export.
 * All types are defined in core/types.ts as a single source; other layers import through this file.
 */
export type {
	CoggitWorkspaceRoot,
	CoggitTreeNode,
	CoggitSnapshot,
} from '@coggit/core';
export type {
	CoggitNodeKind,
	CoggitConfig,
} from '@coggit/core/internal';
