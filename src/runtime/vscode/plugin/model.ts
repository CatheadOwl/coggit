import * as vscode from 'vscode';

import type { CoggitSnapshot, CoggitTreeNode } from '../../../core/types';
import type { CoggitProject, CoggitServices, FileSystem } from '../../../core/interfaces';
import {
	aggregateNodeStatus,
	buildMappingIndex,
	buildSnapshotFromProjects,
	calculateAffected,
	discoverCoggitProjects,
	createCoggitServices,
	RuntimeAcceptanceEvidence,
	summarizeRepresentativeMtime,
	toCognitionFileUri,
	toCognitionFolderReadmeUri,
	type CoggitLogger,
	warnLog,
} from '../../../core/index';
import { createPatternWatcher, type FileChangeCallback, type FileChangeKind } from '../watch/watcher';
import { VscodeFileSystem } from '../adapter/fs';
import { VscodeConfigProvider } from '../adapter/config';
import { VscodeRegistryProvider } from '../adapter/registryFs';
import { NodeProjectLockManager } from '../../node/locks';
import { fromComponents, isEqualOrChildUri, toComponents, uriKey } from '../adapter/uri';
import type { MisplacedTreeEntry } from '../tree/misplacedTreeTypes';
import { handleSourceRenameFiles } from './sourceRename';
import { selectWatchRefreshMode } from './watchRefreshPolicy';
import {
	moveAllMisplacedTreeEntries,
	moveMisplacedTreeEntry,
} from './misplacedActions';
import { runInitProjectFlow, runInitProjectPickerFlow } from './initFlow';
import {
	collectMaintenanceIssueViewState,
	type MaintenanceIssueViewState,
} from './maintenanceIssueService';

const REFRESH_DEBOUNCE_MS = 250;

interface CoggitModelDependencies {
	readonly fs?: FileSystem;
	readonly services?: CoggitServices;
	readonly collectIssueViewState?: (projects: readonly CoggitProject[]) => Promise<MaintenanceIssueViewState>;
	readonly createPatternWatcher?: (pattern: vscode.GlobPattern, onChange: FileChangeCallback) => vscode.Disposable;
	readonly refreshDebounceMs?: number;
}

/**
 * Coggit model orchestration layer.
 * Schedules refreshes, creates cognition files, and owns watcher lifetimes.
 */
export class CoggitModel implements vscode.Disposable {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.onDidChangeEmitter.event;

	private snapshot: CoggitSnapshot = emptySnapshot();
	private orphans: CoggitTreeNode[] = [];
	private misplacedEntries: MisplacedTreeEntry[] = [];
	private readonly onDidChangeMisplacedEmitter = new vscode.EventEmitter<void>();
	readonly onDidChangeMisplaced = this.onDidChangeMisplacedEmitter.event;
	private refreshTimer: NodeJS.Timeout | undefined;
	private readonly watchers: vscode.Disposable[] = [];

	private refreshGeneration = 0;
	private watchEventGeneration = 0;
	private readonly runtimeEvidenceByRoot = new Map<string, RuntimeAcceptanceEvidence>();

	private readonly vfs: FileSystem;
	private readonly services;
	private readonly logger: CoggitLogger | undefined;
	private readonly collectIssueViewStateForProjects: (projects: readonly CoggitProject[]) => Promise<MaintenanceIssueViewState>;
	private readonly createPatternWatcher: (pattern: vscode.GlobPattern, onChange: FileChangeCallback) => vscode.Disposable;
	private readonly refreshDebounceMs: number;
	private projects: CoggitProject[] = [];

	/** Changes collected inside the debounce window. */
	private pendingChanges: Map<string, vscode.Uri> = new Map();

	constructor(logger?: CoggitLogger, dependencies: CoggitModelDependencies = {}) {
		this.logger = logger;
		this.vfs = dependencies.fs ?? new VscodeFileSystem();
		this.services = dependencies.services ?? createCoggitServices(
			this.vfs,
			new VscodeConfigProvider(),
			{ create: (projectRoot) => new VscodeRegistryProvider(projectRoot, logger) },
			logger,
			new NodeProjectLockManager(),
		);
		this.collectIssueViewStateForProjects = dependencies.collectIssueViewState
			?? ((projects) => collectMaintenanceIssueViewState(projects));
		this.createPatternWatcher = dependencies.createPatternWatcher ?? createPatternWatcher;
		this.refreshDebounceMs = dependencies.refreshDebounceMs ?? REFRESH_DEBOUNCE_MS;
	}

	getSnapshot(): CoggitSnapshot {
		return this.snapshot;
	}

	getOrphans(): CoggitTreeNode[] {
		return this.orphans;
	}

	getMisplacedEntries(): MisplacedTreeEntry[] {
		return this.misplacedEntries;
	}

	/**
	 * Move a single misplaced cognition file to its expected location.
	 * Updates the entry's moveState — callers should refresh the tree view.
	 */
	async moveMisplacedEntry(entry: MisplacedTreeEntry): Promise<void> {
		this.misplacedEntries = await moveMisplacedTreeEntry(
			this.projects,
			this.misplacedEntries,
			entry,
		);
		this.onDidChangeMisplacedEmitter.fire();
	}

	/**
	 * Move all misplaced cognition entries in one batch.
	 * Each entry is moved independently; failures are recorded per-entry.
	 */
	async moveAllMisplacedEntries(): Promise<void> {
		if (this.misplacedEntries.length === 0) {
			return;
		}

		this.misplacedEntries = await moveAllMisplacedTreeEntries(
			this.projects,
			this.misplacedEntries,
		);
		this.onDidChangeMisplacedEmitter.fire();
	}

	scheduleRefresh(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}

		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.refresh();
		}, this.refreshDebounceMs);
	}

	/**
	 * Phase 2 incremental affected refresh.
	 */
	schedulePartialRefresh(uri: vscode.Uri): void {
		this.pendingChanges.set(uriKey(uri), uri);

		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}

		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = undefined;
			void this.performPartialRefresh();
		}, this.refreshDebounceMs);
	}

	async refresh(): Promise<void> {
		const refreshGeneration = ++this.refreshGeneration;
		this.disposeWatchers();
		const projects = await discoverCoggitProjects(this.services, {
			runtimeEvidence: (root) => {
				let evidence = this.runtimeEvidenceByRoot.get(root.id);
				if (!evidence) {
					evidence = new RuntimeAcceptanceEvidence();
					this.runtimeEvidenceByRoot.set(root.id, evidence);
				}
				return evidence;
			},
		});
		const snapshot = await buildSnapshotFromProjects(projects);
		if (refreshGeneration !== this.refreshGeneration) {
			return;
		}

		this.projects = projects;
		this.snapshot = snapshot;
		this.orphans = [];
		this.misplacedEntries = [];
		this.installWatchers();
		this.pendingChanges.clear();
		this.onDidChangeEmitter.fire();
		this.onDidChangeMisplacedEmitter.fire();

		const issueViewState = await this.collectIssueViewState(projects);
		if (refreshGeneration !== this.refreshGeneration) {
			return;
		}

		this.orphans = issueViewState.orphans;
		this.misplacedEntries = issueViewState.misplacedEntries;
		this.onDidChangeEmitter.fire();
		this.onDidChangeMisplacedEmitter.fire();
	}

	private async collectIssueViewState(projects: readonly CoggitProject[]): Promise<MaintenanceIssueViewState> {
		try {
			return await this.collectIssueViewStateForProjects(projects);
		} catch (error) {
			warnLog(this.logger, 'ui.maintenance', 'Failed to collect maintenance issue views', {
				error: error instanceof Error ? error.message : String(error),
			});
			return { orphans: [], misplacedEntries: [] };
		}
	}

	async createCognitionFile(node: CoggitTreeNode): Promise<void> {
		if (node.kind !== 'file') {
			return;
		}

		await this.addCognitionForNode(node, 'leaf');
	}

	async createCognitionFolderReadme(node: CoggitTreeNode): Promise<void> {
		if (node.kind !== 'folder' && node.kind !== 'root') {
			return;
		}

		await this.addCognitionForNode(node, 'skeleton');
	}

	async openCognitionForNode(node: CoggitTreeNode): Promise<void> {
		const targetUri = node.kind === 'file'
			? fromComponents(
				node.cognitionUri ?? toCognitionFileUri(
					node.root.sourceRootUri,
					node.root.cognitionRootUri,
					node.sourceUri,
				),
			)
			: fromComponents(
				node.cognitionUri ?? toCognitionFolderReadmeUri(
					node.root.sourceRootUri,
					node.root.cognitionRootUri,
					node.sourceUri,
				),
			);

		if (!(await this.vfs.exists(toComponents(targetUri)))) {
			vscode.window.showInformationMessage(
				`No cognition file exists for ${node.label} yet.`,
			);
			return;
		}

		await openTextDocument(targetUri);
	}

	async initProject(): Promise<void> {
		if (await runInitProjectFlow(this.vfs)) {
			await this.refresh();
		}
	}

	/**
	 * Pick a source directory from the workspace top-level entries, then let
	 * the user confirm / edit the cognition root suffix.
	 *
	 * Faster than typing the full source path, but still lets the user choose
	 * which directory to track.
	 */
	async initProjectWithPicker(): Promise<void> {
		if (await runInitProjectPickerFlow(this.vfs)) {
			await this.refresh();
		}
	}

	dispose(): void {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer);
		}
		this.disposeWatchers();
		this.onDidChangeEmitter.dispose();
	}

	private async addCognitionForNode(node: CoggitTreeNode, kind: 'leaf' | 'skeleton'): Promise<void> {
		const project = this.projects.find((candidate) => candidate.root.id === node.root.id);
		if (!project) {
			vscode.window.showErrorMessage(`CogGit project not found for ${node.label}.`);
			return;
		}

		const result = await project.addCognition(node.relativePath, { kind });
		if (!result.created) {
			vscode.window.showInformationMessage(
				`Cognition file already exists: ${result.cognitionPath}`,
			);
		}

		await openTextDocument(fromComponents(result.cognitionUri));
		await this.refresh();
	}

	/**
	 * Incremental refresh for existing mapped files. Unknown paths mean the tree
	 * shape may have changed, so fall back to a full rebuild.
	 */
	private async performPartialRefresh(): Promise<void> {
		const refreshGeneration = ++this.refreshGeneration;
		const changedUris = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();
		const changedPaths = changedUris.map((uri) => uriKey(uri));

		const mappingIndex = buildMappingIndex(this.snapshot.allNodes);
		const affected = calculateAffected(changedPaths, mappingIndex);

		if (affected.pairs.length === 0) {
			if (this.hasChangesUnderKnownRoots(changedUris)) {
				await this.refresh();
			}
			return;
		}

		for (const pair of affected.pairs) {
			if (refreshGeneration !== this.refreshGeneration) {
				return;
			}

			const existingNode = this.snapshot.nodeBySourceUri.get(pair.sourcePath);
			if (!existingNode || existingNode.kind !== 'file') {
				await this.refresh();
				return;
			}

			const project = this.projects.find((candidate) => candidate.root.id === existingNode.root.id);
			if (!project) {
				await this.refresh();
				return;
			}

			const refreshedNode = await project.refreshNode(existingNode.relativePath);
			if (refreshGeneration !== this.refreshGeneration) {
				return;
			}
			if (!refreshedNode || refreshedNode.kind !== 'file') {
				await this.refresh();
				return;
			}

			refreshedNode.parent = existingNode.parent;
			if (existingNode.parent?.children) {
				const childIndex = existingNode.parent.children.findIndex((child) => child.id === existingNode.id);
				if (childIndex >= 0) {
					existingNode.parent.children[childIndex] = refreshedNode;
				}
			}

			this.snapshot.nodeById.delete(existingNode.id);
			this.snapshot.nodeById.set(refreshedNode.id, refreshedNode);
			this.snapshot.nodeBySourceUri.set(pair.sourcePath, refreshedNode);
			const allNodeIndex = this.snapshot.allNodes.findIndex((node) => node.id === existingNode.id);
			if (allNodeIndex >= 0) {
				this.snapshot.allNodes[allNodeIndex] = refreshedNode;
			}
		}
		if (refreshGeneration !== this.refreshGeneration) {
			return;
		}

		this.propagateFolderState();
		this.snapshot.mappingIndex = buildMappingIndex(this.snapshot.allNodes);
		await Promise.all(this.projects.map((project) => project.flush()));

		this.onDidChangeEmitter.fire();
	}

	private hasChangesUnderKnownRoots(changedUris: vscode.Uri[]): boolean {
		return changedUris.some((uri) => this.snapshot.roots.some((rootNode) =>
			isEqualOrChildUri(fromComponents(rootNode.root.sourceRootUri), uri) ||
			isEqualOrChildUri(fromComponents(rootNode.root.cognitionRootUri), uri),
		));
	}

	/**
	 * Propagate legacy freshness and layered status bottom-up.
	 */
	private propagateFolderState(): void {
		const nodes = [...this.snapshot.allNodes].reverse();
		for (const node of nodes) {
			if (node.kind === 'file' || node.kind === 'error') {continue;}
			if (!node.children || node.children.length === 0) {continue;}

			node.status = aggregateNodeStatus({
				ownStatus: node.ownStatus,
				descendantStatuses: node.children.map((child) => child.status),
			});
			node.representativeMtimeMs = summarizeRepresentativeMtime(node.children);
		}
	}

	private installWatchers(): void {
		this.watchers.push(
			vscode.workspace.onDidChangeWorkspaceFolders(() =>
				this.scheduleRefresh(),
			),
			vscode.workspace.onDidRenameFiles((event) => {
				void this.onFilesRenamed(event);
			}),
		);

		for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
			this.watchers.push(
				this.createPatternWatcher(
					new vscode.RelativePattern(
						workspaceFolder,
						'**/.coggit/config.yaml',
					),
					() => this.scheduleRefresh(),
				),
			);
		}

		for (const root of this.snapshot.roots.map((node) => node.root)) {
			this.watchers.push(
				this.createPatternWatcher(
					new vscode.RelativePattern(fromComponents(root.sourceRootUri), '**/*'),
					(uri, kind) => this.onSourceFileChanged(uri, kind),
				),
				this.createPatternWatcher(
					new vscode.RelativePattern(fromComponents(root.cognitionRootUri), '**/*'),
					(uri, kind) => this.onCognitionFileChanged(uri, kind),
				),
			);
		}
	}

	private onSourceFileChanged(uri: vscode.Uri, kind: FileChangeKind): void {
		const eventGeneration = ++this.watchEventGeneration;
		void this.recordSourceChangeAndRefresh(uri, kind, eventGeneration);
	}

	private async recordSourceChangeAndRefresh(
		uri: vscode.Uri,
		kind: FileChangeKind,
		eventGeneration: number,
	): Promise<void> {
		await Promise.all(this.projects.map((project) =>
			project.recordSourceChange(toComponents(uri), eventGeneration),
		));
		if (kind !== 'change') {
			await Promise.all(this.projects.map((project) =>
				project.recordDirectoryEntryChange(toComponents(uri), eventGeneration),
			));
		}
		if (selectWatchRefreshMode(kind, this.snapshot.mappingIndex !== undefined) === 'full') {
			this.scheduleRefresh();
			return;
		}
		this.schedulePartialRefresh(uri);
	}

	private onCognitionFileChanged(uri: vscode.Uri, kind: FileChangeKind): void {
		const eventGeneration = ++this.watchEventGeneration;
		void this.recordCognitionChangeAndRefresh(uri, kind, eventGeneration);
	}

	private async recordCognitionChangeAndRefresh(
		uri: vscode.Uri,
		kind: FileChangeKind,
		eventGeneration: number,
	): Promise<void> {
		await Promise.all(this.projects.map((project) =>
			project.recordCognitionChange(toComponents(uri), eventGeneration),
		));
		if (selectWatchRefreshMode(kind, this.snapshot.mappingIndex !== undefined) === 'full') {
			this.scheduleRefresh();
			return;
		}
		this.schedulePartialRefresh(uri);
	}

	private async onFilesRenamed(event: vscode.FileRenameEvent): Promise<void> {
		await handleSourceRenameFiles(
			this.projects,
			event.files,
			() => this.scheduleRefresh(),
			++this.watchEventGeneration,
		);
	}

	private disposeWatchers(): void {
		for (const watcher of this.watchers.splice(0)) {
			watcher.dispose();
		}
	}
}

async function openTextDocument(uri: vscode.Uri): Promise<void> {
	const document = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(document, { preview: true });
}

function emptySnapshot(): CoggitSnapshot {
	return {
		roots: [],
		allNodes: [],
		nodeById: new Map(),
		nodeBySourceUri: new Map(),
	};
}
