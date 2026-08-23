import type { CoggitProject } from '@coggit/core';
import type { MisplacedTreeEntry } from '../tree/misplacedTreeTypes';

export async function collectMisplacedTreeEntries(
	projects: readonly CoggitProject[],
): Promise<MisplacedTreeEntry[]> {
	const allEntries = await Promise.all(
		projects.map(async (project) => {
			const entries = await project.listMisplacedCognition();
			return entries.map((entry): MisplacedTreeEntry => ({
				...entry,
				rootId: project.root.id,
				moveState: 'pending',
			}));
		}),
	);
	return allEntries.flat();
}

export async function moveMisplacedTreeEntry(
	projects: readonly CoggitProject[],
	entries: readonly MisplacedTreeEntry[],
	entry: MisplacedTreeEntry,
): Promise<MisplacedTreeEntry[]> {
	const project = projects.find((p) => p.root.id === entry.rootId);
	if (!project) {
		return withEntryError(entries, entry, `Project "${entry.rootId}" not found`);
	}

	const error = await project.moveCognitionToExpected(entry);
	if (error) {
		return withEntryError(entries, entry, error);
	}

	return entries.filter(
		(candidate) =>
			candidate !== entry
			&& !(candidate.registryKey === entry.registryKey && candidate.sourcePath === entry.sourcePath),
	);
}

export async function moveAllMisplacedTreeEntries(
	projects: readonly CoggitProject[],
	entries: readonly MisplacedTreeEntry[],
): Promise<MisplacedTreeEntry[]> {
	let nextEntries = [...entries];
	for (const entry of entries) {
		nextEntries = await moveMisplacedTreeEntry(projects, nextEntries, entry);
	}
	return nextEntries;
}

function withEntryError(
	entries: readonly MisplacedTreeEntry[],
	entry: MisplacedTreeEntry,
	message: string,
): MisplacedTreeEntry[] {
	return entries.map((candidate) => {
		if (candidate !== entry) {
			return candidate;
		}
		return {
			...candidate,
			moveState: 'failed',
			errorMessage: message,
		};
	});
}
