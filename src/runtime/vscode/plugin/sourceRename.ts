import * as vscode from 'vscode';

import type { CoggitProject } from '../../../core/interfaces';
import { fromComponents, toComponents, uriRelativePath } from '../adapter/uri';

export interface SourceRenameFile {
	readonly oldUri: vscode.Uri;
	readonly newUri: vscode.Uri;
}

export async function handleSourceRenameFiles(
	projects: readonly CoggitProject[],
	files: readonly SourceRenameFile[],
	onRegistryChanged: () => void,
	eventGeneration = Date.now(),
): Promise<boolean> {
	let registryChanged = false;

	for (const file of files) {
		for (const project of projects) {
			const oldUri = toComponents(file.oldUri);
			const newUri = toComponents(file.newUri);
			const oldSourceRelative = uriRelativePath(fromComponents(project.root.sourceRootUri), file.oldUri);
			const newSourceRelative = uriRelativePath(fromComponents(project.root.sourceRootUri), file.newUri);
			if (oldSourceRelative === undefined || newSourceRelative === undefined) {
				continue;
			}

			if (await project.applySourceRename(oldUri, newUri)) {
				registryChanged = true;
			}
			if (await project.recordDirectoryEntryChange(oldUri, eventGeneration)) {
				registryChanged = true;
			}
			if (await project.recordDirectoryEntryChange(newUri, eventGeneration)) {
				registryChanged = true;
			}
		}
	}

	// `registryChanged` is deliberately broad: `recordDirectoryEntryChange`
	// returns true whenever runtime ordering evidence was recorded, even if no
	// durable registry write happened. For a rename any such observation means
	// the tree may have changed, so a refresh is the right outcome.
	if (registryChanged) {
		onRegistryChanged();
	}

	return registryChanged;
}
