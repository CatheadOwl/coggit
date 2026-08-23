import * as vscode from 'vscode';

import type { CoggitSnapshot, CoggitTreeNode, ObservedStatus } from '@coggit/core';
import { nodeClipboardStatusText, nodeTooltip } from '../../../format/nodePresentation';
import { toCoggitResourceUri } from '../adapter/resourceMapper';
import { fromComponents } from '../adapter/uri';

/** Extract the file extension from a label (e.g. "file.ts" → ".ts"). */
function getExtension(label: string): string {
	const dot = label.lastIndexOf('.');
	return dot > 0 ? label.substring(dot) : '';
}

export class CoggitTreeDataProvider implements vscode.TreeDataProvider<CoggitTreeNode> {
	private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CoggitTreeNode | undefined>();
	readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

	/** Active file-extension filter. `undefined` means show everything. */
	private _fileExtensionFilter: string[] | undefined;

	/** When true, only show nodes that have an observed status (i.e. tracked by CogGit). */
	private _cognizedOnly: boolean;

	constructor(
		private readonly getSnapshot: () => CoggitSnapshot,
		cognizedOnly?: boolean,
		initialFileExtensionFilter?: string[],
	) {
		this._cognizedOnly = cognizedOnly ?? false;
		if (initialFileExtensionFilter && initialFileExtensionFilter.length > 0) {
			const normalised = initialFileExtensionFilter
				.map((e) => (e.startsWith('.') ? e : `.${e}`))
				.filter((e) => e.length > 1);
			this._fileExtensionFilter = normalised.length > 0 ? [...new Set(normalised)] : undefined;
		}
	}

	// ─── Filters API ───────────────────────────────────────────────────────────────

	get fileExtensionFilter(): string[] | undefined {
		return this._fileExtensionFilter;
	}

	get showOnlyCognized(): boolean {
		return this._cognizedOnly;
	}

	set showOnlyCognized(value: boolean) {
		this._cognizedOnly = value;
		this.refresh();
	}

	/**
	 * Set an active filter by file extension.
	 * Pass `undefined` or an empty array to clear.
	 * Extensions are normalised to leading-dot form (e.g. "ts" → ".ts").
	 */
	setFileExtensionFilter(extensions: string[] | undefined): void {
		const normalised = (extensions ?? [])
			.map((e) => (e.startsWith('.') ? e : `.${e}`))
			.filter((e) => e.length > 1);
		this._fileExtensionFilter = normalised.length > 0 ? [...new Set(normalised)] : undefined;
		this.refresh();
	}

	refresh(): void {
		this.onDidChangeTreeDataEmitter.fire(undefined);
	}

	getTreeItem(element: CoggitTreeNode): vscode.TreeItem {
		const collapsibleState = element.kind === 'file' || element.kind === 'error'
			? vscode.TreeItemCollapsibleState.None
			: vscode.TreeItemCollapsibleState.Collapsed;
		const item = new vscode.TreeItem(element.label, collapsibleState);
		item.id = element.id;
		item.resourceUri = toCoggitResourceUri(fromComponents(element.resourceUri));
		item.contextValue = this.getTreeItemContext(element);
		item.tooltip = this.buildTooltip(element);

		if (element.kind !== 'error') {
			item.command = {
				command: 'coggit.openCognitionFile',
				title: 'Open Cognition File',
				arguments: [element],
			};
		}

		return item;
	}

	getChildren(element?: CoggitTreeNode): CoggitTreeNode[] {
		if (!element) {
			return this.getSnapshot().roots;
		}

		const children = this.sortChildren(element.children ?? []);

		return children.filter((child) => {
			if (this._fileExtensionFilter && !this.shouldShowNode(child)) {
				return false;
			}
			if (this._cognizedOnly && !this.shouldShowByCognition(child)) {
				return false;
			}
			return true;
		});
	}

	getParent(element: CoggitTreeNode): CoggitTreeNode | undefined {
		return element.parent;
	}

	getStatusSummary(element: CoggitTreeNode): ObservedStatus | undefined {
		return element.status?.observedStatus;
	}

	private getTreeItemContext(element: CoggitTreeNode): string | undefined {
		if (element.kind === 'error') {
			return element.contextValue;
		}

		const own = element.status?.coverage?.ownCognition;
		if (own === 'present') {
			return `${element.kind === 'file' ? 'coggitFile' : element.kind === 'folder' ? 'coggitFolder' : 'coggitRoot'}Present`;
		}
		return `${element.kind === 'file' ? 'coggitFile' : element.kind === 'folder' ? 'coggitFolder' : 'coggitRoot'}Untracked`;
	}

	private sortChildren(children: CoggitTreeNode[]): CoggitTreeNode[] {
		return [...children].sort((left, right) => left.label.localeCompare(right.label));
	}

	private buildTooltip(element: CoggitTreeNode): string | vscode.MarkdownString | undefined {
		// No observed status means CogGit has no meaningful information for this
		// node (e.g. source file exists but no cognition file and no tracking).
		// Without a status label, the tooltip would only show "Own issues: 0 /
		// Descendant issues: 0" which is noise.
		if (!element.status?.observedStatus) {
			return undefined;
		}
		const copyArgs = encodeURIComponent(JSON.stringify([
			nodeClipboardStatusText(element),
			`Copied status for "${element.label}" to clipboard`,
		]));
		const tooltip = new vscode.MarkdownString(
			`[$(copy) Copy status](command:coggit.copyTextToClipboard?${copyArgs} "Copy status")\n\n---\n\n`,
			true,
		);
		tooltip.appendMarkdown(nodeTooltip(element));
		tooltip.isTrusted = { enabledCommands: ['coggit.copyTextToClipboard'] };
		return tooltip;
	}

	// ─── Filter helpers ───────────────────────────────────────────────────────────

	/**
	 * Check whether a node (or any of its descendants) matches the active filter.
	 * Used in `getChildren` to prune non-matching branches from the tree.
	 */
	private shouldShowNode(node: CoggitTreeNode): boolean {
		if (node.kind === 'file') {
			return this._fileExtensionFilter!.includes(getExtension(node.label));
		}
		if (node.kind === 'folder') {
			return (node.children ?? []).some((child) => this.shouldShowNode(child));
		}
		// root / error — always show
		return true;
	}

	/**
	 * Check whether a node should be shown when the cognition-only filter is active.
	 * Reuses the same condition as {@link buildTooltip}: a node with an
	 * {@link ObservedStatus} has tracked cognition; one without doesn't.
	 * Folders already have aggregated {@code observedStatus} from their descendants,
	 * so this single check covers both files and folders.
	 */
	private shouldShowByCognition(node: CoggitTreeNode): boolean {
		// Always show error nodes regardless of cognition state.
		if (node.kind === 'error') {
			return true;
		}
		return node.status?.observedStatus !== undefined;
	}
}
