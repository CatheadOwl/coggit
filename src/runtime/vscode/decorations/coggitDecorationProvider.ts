import * as vscode from 'vscode';

import type { CoggitSnapshot, CoggitTreeNode } from '../../../core/types';
import { COGGIT_RESOURCE_SCHEME, fromCoggitResourceUri, toCoggitResourceUri } from '../adapter/resourceMapper';
import { fromComponents, uriKey } from '../adapter/uri';
import { badgeFromStatus } from './badgeFormat.js';

export class CoggitDecorationProvider implements vscode.FileDecorationProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
	readonly onDidChangeFileDecorations = this.onDidChangeEmitter.event;

	constructor(
		private readonly getSnapshot: () => CoggitSnapshot,
	) {}

	refresh(): void {
		const seen = new Set<string>();
		const uris = this.getSnapshot().allNodes
			.map((node) => toCoggitResourceUri(fromComponents(node.sourceUri)))
			.filter((uri) => {
				const key = uriKey(uri);
				if (seen.has(key)) {
					return false;
				}
				seen.add(key);
				return true;
			});
		this.onDidChangeEmitter.fire(uris);
	}

	provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
		if (uri.scheme !== COGGIT_RESOURCE_SCHEME) {
			return undefined;
		}

		const sourceUri = fromCoggitResourceUri(uri);
		const node = this.getSnapshot().nodeBySourceUri.get(uriKey(sourceUri));
		if (!node) {
			return undefined;
		}

		const status = node.status;
		if (!status) {
			return undefined;
		}

		return badgeFromStatus(status);
	}
}
