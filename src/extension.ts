import * as vscode from 'vscode';

import { registerCommands } from './runtime/vscode/commands/registerCommands';
import { CoggitDecorationProvider } from './runtime/vscode/decorations/coggitDecorationProvider';
import { CoggitModel } from './runtime/vscode/plugin/model';
import { CoggitTreeDataProvider } from './runtime/vscode/tree/coggitTreeDataProvider';
import { MisplacedTreeDataProvider } from './runtime/vscode/tree/misplacedTreeDataProvider';
import { OrphanTreeDataProvider } from './runtime/vscode/tree/orphanTreeDataProvider';
import {
	ensureCoggitMcpEntry,
	inspectCoggitMcpEntry,
	migrateLegacyCoggitMcpEntry,
	type CoggitStdioMcpEntry,
} from './runtime/vscode/adapter/mcpJson.js';
import { createVscodeCoggitLogger } from './runtime/vscode/adapter/logger';
import {
	ensureMcpRuntime as installMcpRuntime,
	getMcpLauncherPath,
} from '@coggit/mcp-runtime-support';
import type { CoggitLogger } from '@coggit/core';

type McpExperienceState =
	| { kind: 'notAvailable' }
	| { kind: 'notInitialized'; workspaceRoot: vscode.Uri }
	| { kind: 'configured'; workspaceRoot: vscode.Uri }
	| { kind: 'missing'; workspaceRoot: vscode.Uri }
	| { kind: 'conflict'; workspaceRoot: vscode.Uri }
	| { kind: 'invalidJson'; workspaceRoot: vscode.Uri }
	| { kind: 'invalidShape'; workspaceRoot: vscode.Uri };

type McpStdioServerDefinitionConstructor = new (
	label: string,
	command: string,
	args: string[],
	env: Record<string, string>,
	version: string,
) => { cwd?: vscode.Uri };

type VscodeMcpApi = {
	McpStdioServerDefinition?: McpStdioServerDefinitionConstructor;
	lm?: {
		registerMcpServerDefinitionProvider?: (
			id: string,
			provider: {
				onDidChangeMcpServerDefinitions: vscode.Event<void>;
				provideMcpServerDefinitions: () => Promise<unknown[]>;
			},
		) => vscode.Disposable;
	};
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const logChannel = vscode.window.createOutputChannel('CogGit');
	const logger = createVscodeCoggitLogger(logChannel);
	const model = new CoggitModel(logger);
	const cognizedOnly = vscode.workspace.getConfiguration('coggit.tree')
		.get<boolean>('showOnlyCognized', false);
	const initialExtensions = vscode.workspace.getConfiguration('coggit.tree')
		.get<string[]>('fileExtensionFilter', []);
	const treeDataProvider = new CoggitTreeDataProvider(
		() => model.getSnapshot(),
		cognizedOnly,
		initialExtensions,
	);
	const treeView = vscode.window.createTreeView('coggit.ghostExplorer', {
		treeDataProvider,
		showCollapseAll: true,
	});
	const orphanProvider = new OrphanTreeDataProvider(
		() => model.getOrphans(),
	);
	const orphanView = vscode.window.createTreeView('coggit.orphanExplorer', {
		treeDataProvider: orphanProvider,
		showCollapseAll: true,
	});
	const misplacedProvider = new MisplacedTreeDataProvider(
		() => model.getMisplacedEntries(),
	);
	const misplacedView = vscode.window.createTreeView('coggit.misplacedExplorer', {
		treeDataProvider: misplacedProvider,
		showCollapseAll: true,
	});
	const decorationProvider = new CoggitDecorationProvider(() => model.getSnapshot());

	// ── MCP Registration ───────────────────────────────────────────────────
	const channel = vscode.window.createOutputChannel('CogGit MCP');
	const bundledMcpEntryPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'mcp-stdio.js').fsPath;
	const mcpLauncherPath = getMcpLauncherPath();
	let runtimeInstallation: Promise<string> | undefined;
	const ensureMcpRuntime = async (): Promise<string> => {
		runtimeInstallation ??= installMcpRuntime({
			bundledEntryPath: bundledMcpEntryPath,
			version: String(context.extension.packageJSON.version),
			installedBy: 'vscode-extension',
		}).then((installation) => {
			if (installation.changed) {
				channel.appendLine(
					`Installed CogGit MCP runtime ${installation.activeVersion} (${installation.activeIntegrity}) at ${installation.runtimeEntryPath}.`,
				);
			}
			return installation.launcherPath;
		}).finally(() => {
			runtimeInstallation = undefined;
		});
		return runtimeInstallation;
	};
	const mcpDefinitionsChanged = new vscode.EventEmitter<void>();
	const syncMcpRegistration = async () => {
		const state = await getMcpExperienceState(mcpLauncherPath, logger);
		await applyMcpExperienceState(treeView, state);
		mcpDefinitionsChanged.fire();
	};

	context.subscriptions.push(
		model,
		treeView,
		orphanView,
		misplacedView,
		logChannel,
		channel,
		mcpDefinitionsChanged,
		vscode.window.registerFileDecorationProvider(decorationProvider),
	);

	context.subscriptions.push(model.onDidChange(() => {
		treeDataProvider.refresh();
		orphanProvider.refresh();
		decorationProvider.refresh();
		void syncMcpRegistration();
	}));

	context.subscriptions.push(model.onDidChangeMisplaced(() => {
		misplacedProvider.refresh();
	}));
	context.subscriptions.push(createMcpJsonWatcher(syncMcpRegistration));

	registerCommands(context, model, treeView, treeDataProvider, misplacedProvider);
	registerMcpCommands(
		context,
		channel,
		logger,
		mcpLauncherPath,
		ensureMcpRuntime,
		syncMcpRegistration,
	);

	await model.refresh();

	try {
		await ensureMcpRuntime();
		const workspaceRoot = getSingleWorkspaceRoot();
		if (workspaceRoot && await hasWorkspaceCoggitConfig(workspaceRoot)) {
			const migrated = await migrateLegacyCoggitMcpEntry(
				workspaceRoot,
				createStdioMcpEntry(mcpLauncherPath, workspaceRoot),
				bundledMcpEntryPath,
				logger,
			);
			if (migrated) {
				channel.appendLine('Migrated the workspace CogGit MCP entry to the stable user launcher.');
			}
		}
		await syncMcpRegistration();

		const mcpApi = vscode as typeof vscode & VscodeMcpApi;
		const registerMcpServerDefinitionProvider = mcpApi.lm?.registerMcpServerDefinitionProvider;
		const McpStdioServerDefinition = mcpApi.McpStdioServerDefinition;
		if (
			typeof registerMcpServerDefinitionProvider === 'function'
			&& typeof McpStdioServerDefinition === 'function'
		) {
			const provider = {
				onDidChangeMcpServerDefinitions: mcpDefinitionsChanged.event,
				async provideMcpServerDefinitions() {
					await ensureMcpRuntime();
					const workspaceRoot = getSingleWorkspaceRoot();
					if (!workspaceRoot || !(await hasWorkspaceCoggitConfig(workspaceRoot))) {
						return [];
					}

					const mcpEntry = createStdioMcpEntry(mcpLauncherPath, workspaceRoot);
					const definition = new McpStdioServerDefinition(
						'CogGit',
						mcpEntry.command,
						mcpEntry.args,
						{},
						context.extension.packageJSON.version,
					);
					if (workspaceRoot) {
						definition.cwd = workspaceRoot;
					}
					return [
						definition,
					];
				},
			};
			context.subscriptions.push(
				registerMcpServerDefinitionProvider('coggit', provider),
			);
			channel.appendLine('Registered CogGit stdio MCP provider for VS Code.');
		} else {
			channel.appendLine('VS Code MCP provider API is unavailable in this host.');
		}
	} catch (err) {
		channel.appendLine(`Failed to register MCP entry: ${err}`);
	}
}

export function deactivate(): void { }

function registerMcpCommands(
	context: vscode.ExtensionContext,
	channel: vscode.OutputChannel,
	logger: CoggitLogger,
	mcpLauncherPath: string,
	ensureMcpRuntime: () => Promise<string>,
	syncMcpRegistration: () => Promise<void>,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('coggit.configureMcp', async () => {
			const workspaceRoot = getSingleWorkspaceRoot();
			if (!workspaceRoot) {
				vscode.window.showWarningMessage('Open a workspace folder before configuring CogGit MCP.');
				return;
			}

			if (!(await hasWorkspaceCoggitConfig(workspaceRoot))) {
				vscode.window.showWarningMessage('Initialize CogGit before configuring MCP.');
				return;
			}

			try {
				await ensureMcpRuntime();
			} catch (error) {
				channel.appendLine(`Failed to install the CogGit MCP runtime: ${error}`);
				vscode.window.showErrorMessage('CogGit could not install the user-level MCP runtime. See the CogGit MCP output channel for details.');
				return;
			}

			const entry = createStdioMcpEntry(mcpLauncherPath, workspaceRoot);
			const status = await inspectCoggitMcpEntry(workspaceRoot, entry, logger);
			if (status.kind === 'invalidJson') {
				await showInvalidMcpJsonMessage(workspaceRoot);
				await syncMcpRegistration();
				return;
			}
			if (status.kind === 'invalidShape') {
				await showUnsupportedMcpJsonMessage(workspaceRoot);
				await syncMcpRegistration();
				return;
			}

			if (status.kind === 'conflict') {
				if (!(await confirmMcpJsonWrite(workspaceRoot, 'replace'))) {
					return;
				}
			}

			if (status.kind === 'missing') {
				if (!(await confirmMcpJsonWrite(workspaceRoot, 'add'))) {
					return;
				}
			}

			await ensureCoggitMcpEntry(workspaceRoot, entry, logger);
			channel.appendLine(`Configured CogGit MCP in ${vscode.Uri.joinPath(workspaceRoot, '.mcp.json').fsPath}.`);
			vscode.window.setStatusBarMessage('$(check) CogGit MCP configured in workspace .mcp.json', 4000);
			await syncMcpRegistration();
		}),
	);
}

function createMcpJsonWatcher(syncMcpRegistration: () => Promise<void>): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher('**/.mcp.json');
	const sync = () => {
		void syncMcpRegistration();
	};
	return vscode.Disposable.from(
		watcher,
		watcher.onDidCreate(sync),
		watcher.onDidChange(sync),
		watcher.onDidDelete(sync),
		vscode.workspace.onDidChangeWorkspaceFolders(sync),
	);
}

function createStdioMcpEntry(
	mcpLauncherPath: string,
	workspaceRoot: vscode.Uri | undefined,
): CoggitStdioMcpEntry {
	return {
		command: 'node',
		args: [mcpLauncherPath],
		cwd: workspaceRoot?.fsPath,
	};
}

async function hasWorkspaceCoggitConfig(workspaceRoot: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(
			vscode.Uri.joinPath(workspaceRoot, '.coggit', 'config.yaml'),
		);
		return true;
	} catch {
		return false;
	}
}

async function getMcpExperienceState(
	mcpLauncherPath: string,
	logger: CoggitLogger,
): Promise<McpExperienceState> {
	const workspaceRoot = getSingleWorkspaceRoot();
	if (!workspaceRoot) {
		return { kind: 'notAvailable' };
	}

	if (!(await hasWorkspaceCoggitConfig(workspaceRoot))) {
		return { kind: 'notInitialized', workspaceRoot };
	}

	const status = await inspectCoggitMcpEntry(
		workspaceRoot,
		createStdioMcpEntry(mcpLauncherPath, workspaceRoot),
		logger,
	);
	return { kind: status.kind, workspaceRoot };
}

async function applyMcpExperienceState(
	treeView: vscode.TreeView<unknown>,
	state: McpExperienceState,
): Promise<void> {
	treeView.message = mcpTreeMessage(state);
	await vscode.commands.executeCommand('setContext', 'coggit.mcpConfigNeedsAction', isMcpConfigActionable(state));
	await vscode.commands.executeCommand('setContext', 'coggit.mcpConfigState', state.kind);
}

function mcpTreeMessage(state: McpExperienceState): string | undefined {
	switch (state.kind) {
		case 'missing':
			return 'CogGit MCP is not configured. Use the plug button in this view title to add only mcpServers.coggit to .mcp.json.';
		case 'conflict':
			return 'CogGit MCP needs attention. Use the plug button to review mcpServers.coggit in .mcp.json.';
		case 'invalidJson':
			return 'CogGit MCP needs attention. .mcp.json is not valid JSON; use the plug button to open it.';
		case 'invalidShape':
			return 'CogGit MCP needs attention. .mcp.json must be an object with an optional object mcpServers field.';
		case 'configured':
		case 'notAvailable':
		case 'notInitialized':
			return undefined;
	}
}

function isMcpConfigActionable(state: McpExperienceState): boolean {
	return state.kind === 'missing'
		|| state.kind === 'conflict'
		|| state.kind === 'invalidJson'
		|| state.kind === 'invalidShape';
}

async function confirmMcpJsonWrite(
	workspaceRoot: vscode.Uri,
	mode: 'add' | 'replace',
): Promise<boolean> {
	const actionLabel = mode === 'add' ? 'Add CogGit entry' : 'Replace CogGit entry';
	const message = mode === 'add'
		? 'Add CogGit MCP to workspace .mcp.json? CogGit will only write mcpServers.coggit and preserve other MCP servers.'
		: 'Replace the existing CogGit MCP entry in workspace .mcp.json? CogGit will only update mcpServers.coggit and preserve other MCP servers.';
	const actions = mode === 'add'
		? [actionLabel]
		: [actionLabel, 'Open .mcp.json'];
	const action = await vscode.window.showInformationMessage(
		message,
		{ modal: true },
		...actions,
	);
	if (action === 'Open .mcp.json') {
		await openMcpJson(workspaceRoot);
		return false;
	}
	return action === actionLabel;
}

async function showInvalidMcpJsonMessage(workspaceRoot: vscode.Uri): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'CogGit cannot configure MCP because workspace .mcp.json is not valid JSON.',
		'Open .mcp.json',
	);
	if (action === 'Open .mcp.json') {
		await openMcpJson(workspaceRoot);
	}
}

async function showUnsupportedMcpJsonMessage(workspaceRoot: vscode.Uri): Promise<void> {
	const action = await vscode.window.showErrorMessage(
		'CogGit cannot configure MCP because workspace .mcp.json must be an object with an optional object mcpServers field.',
		'Open .mcp.json',
	);
	if (action === 'Open .mcp.json') {
		await openMcpJson(workspaceRoot);
	}
}

async function openMcpJson(workspaceRoot: vscode.Uri): Promise<void> {
	const mcpJsonUri = vscode.Uri.joinPath(workspaceRoot, '.mcp.json');
	const document = await vscode.workspace.openTextDocument(mcpJsonUri);
	await vscode.window.showTextDocument(document, { preview: false });
}

/** Return the first workspace folder root, or `undefined`. */
function getSingleWorkspaceRoot(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}
