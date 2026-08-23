import * as vscode from 'vscode';

import type { CoggitTreeNode } from '@coggit/core';
import { nodeClipboardStatusText } from '../../../format/nodePresentation.js';
import { buildMisplacedInfoText } from '../../../format/misplacedInfoText.js';
import type { CoggitModel } from '../plugin/model';
import { CoggitTreeDataProvider } from '../tree/coggitTreeDataProvider';
import type { MisplacedTreeDataProvider } from '../tree/misplacedTreeDataProvider';
import { fromComponents } from '../adapter/uri';

export function registerCommands(
	context: vscode.ExtensionContext,
	model: CoggitModel,
	treeView: vscode.TreeView<CoggitTreeNode>,
	treeDataProvider: CoggitTreeDataProvider,
	misplacedProvider: MisplacedTreeDataProvider,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('coggit.refresh', async () => {
			await model.refresh();
		}),
		vscode.commands.registerCommand('coggit.initProject', async () => {
			await model.initProject();
		}),
		vscode.commands.registerCommand('coggit.initProjectWithPicker', async () => {
			await model.initProjectWithPicker();
		}),
		vscode.commands.registerCommand('coggit.createCognitionFile', async (node?: CoggitTreeNode) => {
			if (!node) {
				return;
			}

			await model.createCognitionFile(node);
			await revealNode(treeView, node);
		}),
		vscode.commands.registerCommand('coggit.createCognitionFolderReadme', async (node?: CoggitTreeNode) => {
			if (!node) {
				return;
			}

			await model.createCognitionFolderReadme(node);
			await revealNode(treeView, node);
		}),
		vscode.commands.registerCommand('coggit.openCognitionFile', async (node?: CoggitTreeNode) => {
			if (!node) {
				return;
			}

			await model.openCognitionForNode(node);
		}),
		vscode.commands.registerCommand('coggit.openSourceFile', async (item?: { sourceUri: { scheme: string; authority: string; path: string; query: string; fragment: string } }) => {
			if (!item) {
				return;
			}

			const uri = fromComponents(item.sourceUri);
			let stat: vscode.FileStat | null = null;
			try {
				stat = await vscode.workspace.fs.stat(uri);
			} catch {
				// stat failed — proceed to open as text document
			}
			if (stat?.type === vscode.FileType.Directory) {
				await vscode.commands.executeCommand('revealInExplorer', uri);
			} else {
				const document = await vscode.workspace.openTextDocument(uri);
				await vscode.window.showTextDocument(document, { preview: true });
			}
		}),
		vscode.commands.registerCommand('coggit.setFileFilter', async () => {
			await showExtensionFilterQuickPick(treeDataProvider);
		}),
		vscode.commands.registerCommand('coggit.copyNodeStatus', async (node?: CoggitTreeNode) => {
			if (!node) {
				return;
			}

			const text = nodeClipboardStatusText(node);

			await vscode.env.clipboard.writeText(text);
			vscode.window.setStatusBarMessage(
				`\$(check) Copied status for "${node.label}" to clipboard`,
				3000,
			);
		}),
		vscode.commands.registerCommand('coggit.copyTextToClipboard', async (text: string, message?: string) => {
			await vscode.env.clipboard.writeText(text);
			if (message) {
				vscode.window.setStatusBarMessage(`\$(check) ${message}`, 3000);
			}
		}),
		// ── Misplaced cognition commands ───────────────────────────────────
		vscode.commands.registerCommand('coggit.moveMisplacedCognition', async (entryOrUri?: unknown) => {
			await handleMoveMisplacedCognition(model, entryOrUri);
			misplacedProvider.refresh();
		}),
		vscode.commands.registerCommand('coggit.moveAllMisplacedCognition', async () => {
			await model.moveAllMisplacedEntries();
			misplacedProvider.refresh();
			await model.refresh(); // full refresh to update the ghost tree
		}),
		// ── Cognition-only toggle ────────────────────────────────────────────
		vscode.commands.registerCommand('coggit.toggleCognizedOnly', async () => {
			const config = vscode.workspace.getConfiguration('coggit.tree');
			const current = config.get<boolean>('showOnlyCognized', false);
			await config.update('showOnlyCognized', !current, vscode.ConfigurationTarget.Workspace);
			treeDataProvider.showOnlyCognized = !current;
		}),

		// ── Copy Info ────────────────────────────────────────────────────────
		vscode.commands.registerCommand('coggit.copyMisplacedInfo', async (entry?: unknown) => {
			if (!entry || typeof (entry as import('../tree/misplacedTreeTypes').MisplacedTreeEntry).registryKey !== 'string') {
				return;
			}
			const text = buildMisplacedInfoText(entry as import('../tree/misplacedTreeTypes').MisplacedTreeEntry);
			await vscode.env.clipboard.writeText(text);
			vscode.window.setStatusBarMessage(
				`\$(check) Copied info for "${(entry as import('../tree/misplacedTreeTypes').MisplacedTreeEntry).sourcePath}" to clipboard`,
				3000,
			);
		}),
	);

	// Synchronise the tree-view description with the active filter.
	treeDataProvider.onDidChangeTreeData(() => updateTreeViewDescription(treeDataProvider, treeView));
	updateTreeViewDescription(treeDataProvider, treeView);
}

/**
 * Open a QuickPick to add/remove file-extension filters interactively.
 *
 * The picker lists the currently active extensions with a remove button per
 * entry, plus an "Add extension…" action. Selecting an existing extension
 * also removes it. The list is persisted to VS Code settings immediately
 * on each mutation so the setting can also be edited directly in settings.json.
 */
async function showExtensionFilterQuickPick(
	treeDataProvider: CoggitTreeDataProvider,
): Promise<void> {
	const quickPick = vscode.window.createQuickPick();
	quickPick.placeholder = 'Manage extension filter — select to remove, pick Add to add';
	quickPick.matchOnDescription = true;

	const rebuildItems = (): void => {
		const current = treeDataProvider.fileExtensionFilter ?? [];
		const items: vscode.QuickPickItem[] = [
			{ label: '$(plus) Add extension…', description: 'Type a new file extension to add' },
		];
		if (current.length > 0) {
			items.push({ label: 'Clear all', description: `Remove all ${current.length} extension(s)` });
			items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
			for (const ext of current) {
				items.push({
					label: ext,
					description: 'Click to remove',
					buttons: [{ iconPath: new vscode.ThemeIcon('close'), tooltip: 'Remove' }],
				});
			}
		}
		quickPick.items = items;
	};

	rebuildItems();

	// ── Remove via close button ────────────────────────────────────────────
	quickPick.onDidTriggerItemButton(async (e) => {
		const ext = e.item.label;
		const current = [...(treeDataProvider.fileExtensionFilter ?? [])];
		const idx = current.indexOf(ext);
		if (idx < 0) { return; }
		current.splice(idx, 1);
		await persistExtensionFilter(current, treeDataProvider);
		rebuildItems();
	});

	// ── Accept (Enter / click) ─────────────────────────────────────────────
	quickPick.onDidAccept(async () => {
		const selected = quickPick.selectedItems[0];
		if (!selected) { return; }

		// Add new extension
		if (selected.label === '$(plus) Add extension…') {
			quickPick.hide();
			const input = await vscode.window.showInputBox({
				placeHolder: '.ts',
				prompt: 'Enter a file extension (e.g. .ts, .tsx, .py)',
				validateInput: (value: string) => {
					const norm = value.startsWith('.') ? value : `.${value}`;
					return /^\.[a-zA-Z0-9]+$/.test(norm) ? null : `Invalid extension: "${value}"`;
				},
			});
			if (input !== undefined && input.trim().length > 0) {
				const norm = input.trim().startsWith('.') ? input.trim() : `.${input.trim()}`;
				const current = [...(treeDataProvider.fileExtensionFilter ?? [])];
				if (!current.includes(norm)) {
					current.push(norm);
					await persistExtensionFilter(current, treeDataProvider);
				}
			}
			quickPick.show();
			return;
		}

		// Clear all
		if (selected.label === 'Clear all') {
			await persistExtensionFilter([], treeDataProvider);
			rebuildItems();
			return;
		}

		// Click on an extension → remove it
		const ext = selected.label;
		const current = [...(treeDataProvider.fileExtensionFilter ?? [])];
		const idx = current.indexOf(ext);
		if (idx >= 0) {
			current.splice(idx, 1);
			await persistExtensionFilter(current, treeDataProvider);
			rebuildItems();
		}
	});

	quickPick.onDidHide(() => quickPick.dispose());
	quickPick.show();
}

/**
 * Persist the extension filter to VS Code settings and notify the data provider.
 */
async function persistExtensionFilter(
	extensions: string[],
	treeDataProvider: CoggitTreeDataProvider,
): Promise<void> {
	const config = vscode.workspace.getConfiguration('coggit.tree');
	const value = extensions.length > 0 ? extensions : undefined;
	await config.update('fileExtensionFilter', value, vscode.ConfigurationTarget.Workspace);
	treeDataProvider.setFileExtensionFilter(extensions.length > 0 ? extensions : undefined);
}

function updateTreeViewDescription(
	treeDataProvider: CoggitTreeDataProvider,
	treeView: vscode.TreeView<CoggitTreeNode>,
): void {
	const parts: string[] = [];
	const filter = treeDataProvider.fileExtensionFilter;
	if (filter) { parts.push(`Filter: ${filter.join(', ')}`); }
	if (treeDataProvider.showOnlyCognized) { parts.push('Cognition-only'); }
	treeView.description = parts.length > 0 ? parts.join(' | ') : undefined;
}

/**
 * Handle coggit.moveMisplacedCognition from the misplaced view's context menu.
 */
async function handleMoveMisplacedCognition(
	model: CoggitModel,
	entry: unknown,
): Promise<void> {
	if (!entry || typeof (entry as import('../tree/misplacedTreeTypes').MisplacedTreeEntry).registryKey !== 'string') {
		return;
	}
	await model.moveMisplacedEntry(entry as import('../tree/misplacedTreeTypes').MisplacedTreeEntry);
}

async function revealNode(treeView: vscode.TreeView<CoggitTreeNode>, node: CoggitTreeNode): Promise<void> {
	try {
		await treeView.reveal(node, {
			focus: false,
			select: true,
		});
	} catch {
		// Ignore reveal failures while the tree refreshes.
	}
}
