import * as vscode from 'vscode';

import type { CoggitTreeNode } from '@coggit/core';
import { nodeTooltip } from '../../../format/nodePresentation';
import { toCoggitResourceUri } from '../adapter/resourceMapper';
import { fromComponents } from '../adapter/uri';

/**
 * Tree data provider for orphaned cognition files —
 * cognition files whose paired source file no longer exists.
 */
export class OrphanTreeDataProvider implements vscode.TreeDataProvider<CoggitTreeNode> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CoggitTreeNode | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	constructor(
		private readonly getOrphans: () => CoggitTreeNode[],
	) {}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: CoggitTreeNode): vscode.TreeItem {
		const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
		item.id = element.id;
		item.resourceUri = toCoggitResourceUri(fromComponents(element.resourceUri));
		item.contextValue = 'coggitOrphaned';
		item.tooltip = this.buildTooltip(element);

		item.command = {
			command: 'coggit.openCognitionFile',
			title: 'Open Cognition File',
			arguments: [element],
		};

		return item;
	}

	getChildren(element?: CoggitTreeNode): CoggitTreeNode[] {
		if (element) {
			return []; // orphans are flat — no children
		}
		return this.getOrphans();
	}

	getParent(element: CoggitTreeNode): CoggitTreeNode | undefined {
		return element.parent;
	}

	private buildTooltip(element: CoggitTreeNode): string | vscode.MarkdownString | undefined {
		return new vscode.MarkdownString(nodeTooltip(element));
	}
}
