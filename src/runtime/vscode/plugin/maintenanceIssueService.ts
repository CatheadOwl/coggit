import type { CoggitProject } from '../../../core/interfaces';
import type {
	CoggitTreeNode,
	NodeStatusResult,
	OrphanedCognitionEntry,
} from '../../../core/types';
import { toRelativeUriPath } from '../../../core/index';
import type { MisplacedTreeEntry } from '../tree/misplacedTreeTypes';
import { collectMisplacedTreeEntries } from './misplacedActions';

export interface MaintenanceIssueViewState {
	readonly orphans: CoggitTreeNode[];
	readonly misplacedEntries: MisplacedTreeEntry[];
}

export async function collectMaintenanceIssueViewState(
	projects: readonly CoggitProject[],
): Promise<MaintenanceIssueViewState> {
	const [orphansByProject, misplacedEntries] = await Promise.all([
		Promise.all(projects.map(collectOrphanTreeNodes)),
		collectMisplacedTreeEntries(projects),
	]);

	return {
		orphans: orphansByProject.flat(),
		misplacedEntries,
	};
}

async function collectOrphanTreeNodes(project: CoggitProject): Promise<CoggitTreeNode[]> {
	const entries = await project.listOrphanedCognition();
	return entries.map((entry) => orphanEntryToTreeNode(project, entry));
}

function orphanEntryToTreeNode(
	project: CoggitProject,
	entry: OrphanedCognitionEntry,
): CoggitTreeNode {
	const orphanStatus = orphanedStatus();
	const label = entry.cognitionPath.split('/').pop() ?? entry.registryKey;
	return {
		id: `orphaned:${project.root.id}:${entry.registryKey}`,
		kind: 'file',
		label,
		resourceUri: entry.cognitionUri,
		sourceUri: entry.sourceUri,
		cognitionUri: entry.cognitionUri,
		relativePath: toRelativeUriPath(project.root.sourceRootUri, entry.sourceUri),
		ownStatus: orphanStatus,
		status: orphanStatus,
		contextValue: 'coggitOrphaned',
		root: project.root,
	};
}

function orphanedStatus(): NodeStatusResult {
	return {
		observedStatus: 'stale',
		ownObservedStatus: 'stale',
		issues: [{
			diagnostic: {
				code: 'source-deleted',
				severity: 'error',
				message: 'Registered cognition exists but the paired source appears deleted.',
			},
			actions: [{ label: 'Remove orphaned cognition file or restore source' }],
		}],
		coverage: {
			ownCognition: 'not-applicable',
			isMaterializable: false,
			missingMaterializableCount: 0,
			coveredCount: 0,
		},
	};
}
