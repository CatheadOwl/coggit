import * as vscode from 'vscode';

import type { FileSystem, UriComponents } from '@coggit/core';
import { initProject } from '@coggit/core';
import { toComponents } from '../adapter/uri';
import { joinUriPath } from '@coggit/core/internal';

export async function runInitProjectFlow(vfs: FileSystem): Promise<boolean> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return false;
	}

	const targetFolder = workspaceFolders.length === 1
		? workspaceFolders[0]
		: await pickWorkspaceFolder(workspaceFolders);

	if (!targetFolder) {
		return false;
	}

	if (await alreadyInitialised(vfs, toComponents(targetFolder.uri))) {
		return false;
	}

	const sourceRoot = await vscode.window.showInputBox({
		placeHolder: 'e.g. src',
		value: 'src',
		prompt: 'Source root directory (relative to project root)',
		title: 'CogGit Init - Source Root',
		validateInput: (value: string) => {
			return value.trim().length > 0 ? null : 'Source root cannot be empty';
		},
	});
	if (sourceRoot === undefined) {
		return false;
	}

	const defaultCognitionRoot = `${sourceRoot.trim()}_cognition`;
	const cognitionRoot = await vscode.window.showInputBox({
		placeHolder: defaultCognitionRoot,
		value: defaultCognitionRoot,
		prompt: 'Cognition root directory (relative to project root)',
		title: 'CogGit Init - Cognition Root',
		validateInput: (value: string) => {
			return value.trim().length > 0 ? null : 'Cognition root cannot be empty';
		},
	});
	if (cognitionRoot === undefined) {
		return false;
	}

	await initializeSelectedProject(vfs, targetFolder, {
		sourceRoot: sourceRoot.trim(),
		cognitionRoot: cognitionRoot.trim(),
	});

	const open = '$(link-external) Open Ghost Tree';
	const action = await vscode.window.showInformationMessage(
		`CogGit initialised at \`${targetFolder.uri.fsPath}\``,
		open,
	);
	if (action === open) {
		vscode.commands.executeCommand('coggit.ghostExplorer.focus');
	}

	return true;
}

export async function runInitProjectPickerFlow(vfs: FileSystem): Promise<boolean> {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage('No workspace folder open.');
		return false;
	}

	const targetFolder = workspaceFolders.length === 1
		? workspaceFolders[0]
		: await pickWorkspaceFolder(workspaceFolders);

	if (!targetFolder) {
		return false;
	}

	if (await alreadyInitialised(vfs, toComponents(targetFolder.uri))) {
		return false;
	}

	const projectRoot = toComponents(targetFolder.uri);
	const topLevelDirs = await readTopLevelDirectories(vfs, projectRoot);
	if (topLevelDirs.length === 0) {
		vscode.window.showErrorMessage('No subdirectories found in workspace root.');
		return false;
	}

	const picked = await vscode.window.showQuickPick(
		topLevelDirs.map((name) => ({
			label: name,
			description: `$(folder) ${name}`,
			iconPath: new vscode.ThemeIcon('folder'),
		})),
		{
			placeHolder: 'Select a source directory to track',
			title: 'CogGit Init - Choose Source Directory',
		},
	);
	if (!picked) {
		return false;
	}

	const defaultCognitionSuffix = '_cognition';
	const cognitionRoot = await vscode.window.showInputBox({
		placeHolder: picked.label + defaultCognitionSuffix,
		value: picked.label + defaultCognitionSuffix,
		prompt: 'Cognition root (editable suffix - first part is the source directory name)',
		title: 'CogGit Init - Cognition Root',
		validateInput: (value: string) => {
			return value.trim().length > 0 ? null : 'Cognition root cannot be empty';
		},
	});
	if (cognitionRoot === undefined) {
		return false;
	}

	await initializeSelectedProject(vfs, targetFolder, {
		sourceRoot: picked.label,
		cognitionRoot: cognitionRoot.trim(),
	});

	const open = '$(link-external) Open Ghost Tree';
	const action = await vscode.window.showInformationMessage(
		`CogGit initialised at \`${targetFolder.uri.fsPath}\`: tracking \`"${picked.label}"\` -> \`"${cognitionRoot.trim()}"\``,
		open,
	);
	if (action === open) {
		vscode.commands.executeCommand('coggit.ghostExplorer.focus');
	}

	return true;
}

async function initializeSelectedProject(
	vfs: FileSystem,
	targetFolder: vscode.WorkspaceFolder,
	config: { sourceRoot: string; cognitionRoot: string },
): Promise<void> {
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: `Initialising CogGit in "${targetFolder.name}"...`,
	}, () => initProject(vfs, toComponents(targetFolder.uri), config));
}

async function readTopLevelDirectories(
	vfs: FileSystem,
	projectRoot: UriComponents,
): Promise<string[]> {
	try {
		const entries = await vfs.readDirectory(projectRoot);
		return entries
			.filter(([, type]) => (type & 2) !== 0)
			.map(([name]) => name)
			.sort();
	} catch {
		return [];
	}
}

interface WorkspaceFolderPickItem extends vscode.QuickPickItem {
	folder: vscode.WorkspaceFolder;
}

async function alreadyInitialised(vfs: FileSystem, projectRoot: UriComponents): Promise<boolean> {
	const configUri = joinUriPath(projectRoot, '.coggit', 'config.yaml');
	if (await vfs.exists(configUri)) {
		await vscode.window.showWarningMessage('CogGit is already initialised in this workspace folder.');
		return true;
	}
	return false;
}

async function pickWorkspaceFolder(
	folders: readonly vscode.WorkspaceFolder[],
): Promise<vscode.WorkspaceFolder | undefined> {
	const items: WorkspaceFolderPickItem[] = folders.map((f) => ({
		label: f.name,
		description: f.uri.fsPath,
		iconPath: new vscode.ThemeIcon('root-folder'),
		folder: f,
	}));
	const pick = await vscode.window.showQuickPick(items, {
		placeHolder: 'Select a workspace folder to initialise',
		title: 'CogGit Init - Select Workspace Folder',
	});
	return pick?.folder;
}
