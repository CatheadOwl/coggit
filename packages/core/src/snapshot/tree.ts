import type {
	CoggitSnapshot,
	CoggitTreeNode,
	CoggitWorkspaceRoot,
	NodeStatusResult,
	SourceFactKind,
	StatusIssue,
} from '../types';
import type { AcceptanceStore, FileSystem, FreshnessEvidenceStore, UriComponents } from '../interfaces';
import type { AcceptedPair } from '../registryTypes';
import {
	aggregateNodeStatus,
	computeRuntimeStatus,
	summarizeRepresentativeMtime,
} from '../status';
import {
	toCognitionFileUri,
	toCognitionFolderReadmeUri,
	toRelativeUriPath,
} from '../mapping';
import { formatUri, joinUriPath, uriBasename, uriKey } from '../uri-utils';
import { loadGitignoreRules, isIgnoredByGitignoreRules } from '../gitignore';
import { sourcePathToKey } from '../identity';
import { computeSourceFactIdentity } from '../hash';
import { directoryEntryFingerprint } from '../directoryEntrySourceFact';
import { buildMappingIndex } from './mappingIndex';
import { acceptCurrentPair } from '../acceptance';
import { isIgnoredSourceStructureEntry } from '../sourceStructureIgnore';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export interface BuildProjectSnapshotOptions {
	acceptance?: AcceptanceStore | null;
	/** @deprecated v3 test adapter; ignored by the v5 acceptance model. */
	freshnessEvidence?: FreshnessEvidenceStore | null;
}

export function computeFolderFingerprint(children: CoggitTreeNode[]): string {
	return directoryEntryFingerprint(children.map((child) => ({
		name: child.label,
		kind: child.kind === 'folder' || child.kind === 'root' ? 'folder' : 'file',
	})));
}

export function folderSourceKey(relativePath: string): string {
	return relativePath === '.' || relativePath === ''
		? '/'
		: relativePath.replace(/\\/g, '/') + '/';
}

export async function buildProjectSnapshot(
	root: CoggitWorkspaceRoot,
	fs: FileSystem,
	options: BuildProjectSnapshotOptions = {},
): Promise<CoggitSnapshot> {
	const rootNode = await buildRootNode(root, fs, options);
	const allNodes: CoggitTreeNode[] = [];
	const nodeById = new Map<string, CoggitTreeNode>();
	const nodeBySourceUri = new Map<string, CoggitTreeNode>();
	collectNode(rootNode, allNodes, nodeById, nodeBySourceUri);

	return {
		roots: [rootNode],
		allNodes,
		nodeById,
		nodeBySourceUri,
		mappingIndex: buildMappingIndex(allNodes),
	};
}

export async function buildRootNode(
	root: CoggitWorkspaceRoot,
	fs: FileSystem,
	options: BuildProjectSnapshotOptions = {},
): Promise<CoggitTreeNode> {
	const sourceStat = await fs.stat(root.sourceRootUri);
	const cognitionReadmeUri = joinUriPath(root.cognitionRootUri, 'README.md');
	const cognitionStat = await fs.stat(cognitionReadmeUri);
	const rootNode: CoggitTreeNode = {
		id: root.id,
		kind: 'root',
		label: root.label,
		resourceUri: root.projectRootUri,
		sourceUri: root.sourceRootUri,
		cognitionUri: joinUriPath(root.cognitionRootUri, 'README.md'),
		relativePath: '.',
		ownStatus: {
			observedStatus: undefined,
			ownObservedStatus: undefined,
			coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
		},
		status: {
			observedStatus: undefined,
			ownObservedStatus: undefined,
			coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
		},
		contextValue: cognitionStat ? 'coggitRootPresent' : 'coggitRootUntracked',
		children: [],
		root,
	};

	if (!sourceStat || !sourceStat.isDirectory) {
		rootNode.children = [
			createErrorNode(
				rootNode,
				`Missing source root: ${formatUri(root.sourceRootUri)}`,
			),
		];
		return rootNode;
	}

	const rootIgnoreRules = await loadGitignoreRules(
		root.projectRootUri,
		root.projectRootUri,
		{ rules: [] },
		{
			readFile: (uri) => fs.readFile(uri),
			exists: (uri) => fs.exists(uri),
		},
	);
	rootNode.children = await buildDirectoryChildren(
		rootNode,
		root.sourceRootUri,
		root.sourceRootUri,
		rootIgnoreRules,
		fs,
		options,
	);
	const representativeMtimeMs =
		summarizeRepresentativeMtime(rootNode.children) ?? sourceStat.mtimeMs;
	rootNode.representativeMtimeMs = representativeMtimeMs;

	const rootFingerprint = computeFolderFingerprint(rootNode.children);
	const rootCognitionStat = await fs.stat(rootNode.cognitionUri!);
	const rootCognitionContent = rootCognitionStat
		? await fs.readFile(rootNode.cognitionUri!)
		: null;
	const rootAccepted = options.acceptance
		? acceptCurrentPair(
			options.acceptance,
			root.id,
			'/',
			computeSourceFactIdentity('directory-entry', rootFingerprint),
			rootCognitionContent,
		).accepted
		: undefined;
	const ownStatus = await computeNodeStatus({
		sourceUri: root.sourceRootUri,
		cognitionUri: rootNode.cognitionUri,
		relativePath: rootNode.relativePath,
		sourceMtimeMs: legacySourceMtime(options, '/', sourceStat.mtimeMs),
		cognitionMtimeMs: rootCognitionStat?.mtimeMs,
		sourceContent: rootFingerprint,
		sourceFactKind: 'directory-entry',
		readCognitionContent: async () => rootCognitionContent ?? fs.readFile(rootNode.cognitionUri!),
		acceptedPair: rootAccepted,
	});
	const status = aggregateNodeStatus({
		ownStatus,
		descendantStatuses: rootNode.children.map((child) => child.status),
	});
	rootNode.ownStatus = ownStatus;
	rootNode.status = status;
	return rootNode;
}

export async function buildDirectoryChildren(
	parent: CoggitTreeNode,
	directoryUri: UriComponents,
	sourceRootUri: UriComponents,
	inheritedIgnoreRules: Parameters<typeof loadGitignoreRules>[2],
	fs: FileSystem,
	options: BuildProjectSnapshotOptions = {},
): Promise<CoggitTreeNode[]> {
	const ignoreRules = await loadGitignoreRules(
		parent.root.projectRootUri,
		directoryUri,
		inheritedIgnoreRules,
		{
			readFile: (uri) => fs.readFile(uri),
			exists: (uri) => fs.exists(uri),
		},
	);
	const entries = await fs.readDirectory(directoryUri);
	const children: CoggitTreeNode[] = [];

	for (const [name, type] of entries.sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		const childSourceUri = joinUriPath(directoryUri, name);
		const isDirectory = (type & FILE_TYPE_DIRECTORY) !== 0;
		if (isIgnoredSourceStructureEntry(name, isDirectory)) {
			continue;
		}
		if (
			isIgnoredByGitignoreRules(
				parent.root.projectRootUri,
				ignoreRules,
				childSourceUri,
				isDirectory,
			)
		) {
			continue;
		}

		if (isDirectory) {
			children.push(
				await buildFolderNode(
					parent,
					childSourceUri,
					sourceRootUri,
					ignoreRules,
					fs,
					options,
				),
			);
			continue;
		}

		if ((type & FILE_TYPE_FILE) !== 0) {
			children.push(await buildFileNode(parent, childSourceUri, sourceRootUri, fs, options));
		}
	}

	return children;
}

export async function buildFolderNode(
	parent: CoggitTreeNode,
	folderUri: UriComponents,
	sourceRootUri: UriComponents,
	inheritedIgnoreRules: Parameters<typeof loadGitignoreRules>[2],
	fs: FileSystem,
	options: BuildProjectSnapshotOptions = {},
): Promise<CoggitTreeNode> {
	const stat = await fs.stat(folderUri);
	const cognitionUri = toCognitionFolderReadmeUri(
		sourceRootUri,
		parent.root.cognitionRootUri,
		folderUri,
	);
	const cognitionStat = await fs.stat(cognitionUri);
	const relativePath = toRelativeUriPath(sourceRootUri, folderUri);
	const children = await buildDirectoryChildren(
		parentPlaceholder(parent, folderUri),
		folderUri,
		sourceRootUri,
		inheritedIgnoreRules,
		fs,
		options,
	);
	const representativeMtimeMs =
		summarizeRepresentativeMtime(children) ?? stat?.mtimeMs;

	const sourceKey = folderSourceKey(relativePath);
	const fingerprint = computeFolderFingerprint(children);
	const cognitionContent = cognitionStat
		? await fs.readFile(cognitionUri)
		: null;
	const acceptedPair = options.acceptance
		? acceptCurrentPair(
			options.acceptance,
			parent.root.id,
			sourceKey,
			computeSourceFactIdentity('directory-entry', fingerprint),
			cognitionContent,
		).accepted
		: undefined;
	const ownStatus = await computeNodeStatus({
		sourceUri: folderUri,
		cognitionUri,
		relativePath,
		sourceMtimeMs: legacySourceMtime(options, sourceKey, stat?.mtimeMs),
		cognitionMtimeMs: cognitionStat?.mtimeMs,
		sourceContent: fingerprint,
		sourceFactKind: 'directory-entry',
		readCognitionContent: async () => cognitionContent ?? fs.readFile(cognitionUri),
		acceptedPair,
	});
	const status = aggregateNodeStatus({
		ownStatus,
		descendantStatuses: children.map((child) => child.status),
	});
	const folderNode: CoggitTreeNode = {
		id: uriKey(folderUri),
		kind: 'folder',
		label: uriBasename(folderUri),
		resourceUri: folderUri,
		sourceUri: folderUri,
		cognitionUri,
		relativePath,
		ownStatus,
		status,
		contextValue: cognitionStat
			? 'coggitFolderPresent'
			: 'coggitFolderUntracked',
		children,
		parent,
		root: parent.root,
		representativeMtimeMs,
	};

	for (const child of children) {
		child.parent = folderNode;
	}

	return folderNode;
}

export async function buildFileNode(
	parent: CoggitTreeNode,
	fileUri: UriComponents,
	sourceRootUri: UriComponents,
	fs: FileSystem,
	options: BuildProjectSnapshotOptions = {},
): Promise<CoggitTreeNode> {
	const sourceStat = await fs.stat(fileUri);
	const cognitionUri = toCognitionFileUri(
		sourceRootUri,
		parent.root.cognitionRootUri,
		fileUri,
	);
	const cognitionStat = await fs.stat(cognitionUri);
	const relativePath = toRelativeUriPath(sourceRootUri, fileUri);
	const sourceKey = sourcePathToKey(relativePath);
	const sourceContent = sourceStat ? await fs.readFile(fileUri) : '';
	const cognitionContent = cognitionStat ? await fs.readFile(cognitionUri) : null;
	const acceptedPair = options.acceptance
		? acceptCurrentPair(
			options.acceptance,
			parent.root.id,
			sourceKey,
			computeSourceFactIdentity('file-content', sourceContent),
			cognitionContent,
		).accepted
		: undefined;

	const ownStatus = await computeNodeStatus({
		sourceUri: fileUri,
		cognitionUri,
		relativePath,
		sourceMtimeMs: legacySourceMtime(options, sourceKey, sourceStat?.mtimeMs),
		cognitionMtimeMs: cognitionStat?.mtimeMs,
		sourceContent,
		readCognitionContent: async () => cognitionContent ?? fs.readFile(cognitionUri),
		acceptedPair,
	});

	return {
		id: uriKey(fileUri),
		kind: 'file',
		label: uriBasename(fileUri),
		resourceUri: fileUri,
		sourceUri: fileUri,
		cognitionUri,
		relativePath,
		ownStatus,
		status: ownStatus,
		contextValue: cognitionStat ? 'coggitFilePresent' : 'coggitFileUntracked',
		parent,
		root: parent.root,
		representativeMtimeMs: sourceStat?.mtimeMs,
	};
}

interface ComputeNodeStatusInput {
	sourceUri: UriComponents;
	cognitionUri?: UriComponents;
	relativePath: string;
	sourceMtimeMs?: number;
	cognitionMtimeMs?: number;
	sourceContent: string;
	sourceFactKind?: SourceFactKind;
	readCognitionContent: () => Promise<string>;
	acceptedPair?: AcceptedPair | null;
}

function legacySourceMtime(
	options: BuildProjectSnapshotOptions,
	sourceKey: string,
	fallback: number | undefined,
): number | undefined {
	return options.acceptance
		? fallback
		: options.freshnessEvidence?.getFreshnessTimes('', sourceKey).sourceFactMtimeMs ?? fallback;
}

function missingCognitionIssue(): StatusIssue {
	return {
		diagnostic: {
			code: 'missing-cognition',
			severity: 'info',
			message: 'Source file has no paired cognition file.',
		},
		actions: [{ label: 'Create cognition file' }],
	};
}

async function computeNodeStatus(input: ComputeNodeStatusInput): Promise<NodeStatusResult> {
	const ownObservedStatus = input.cognitionMtimeMs === undefined ? undefined : 'stale';
	let ownStatus: NodeStatusResult = ownObservedStatus === undefined
		? {
			observedStatus: undefined,
			ownObservedStatus: undefined,
			issues: [missingCognitionIssue()],
			coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
		}
		: {
			observedStatus: ownObservedStatus,
			ownObservedStatus,
			coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
		};

	if (input.cognitionMtimeMs !== undefined && input.cognitionUri) {
		try {
			const cognitionContent = await input.readCognitionContent();
			const runtimeStatus = computeRuntimeStatus({
				sourceUri: uriKey(input.sourceUri),
				sourceContent: input.sourceContent,
				sourceFactKind: input.sourceFactKind ?? 'file-content',
				sourceMtimeMs: input.sourceMtimeMs ?? 0,
				cognitionUri: uriKey(input.cognitionUri),
				cognitionContent,
				cognitionMtimeMs: input.cognitionMtimeMs,
				acceptedPair: input.acceptedPair,
			});
			ownStatus = {
				observedStatus: runtimeStatus.observedStatus,
				ownObservedStatus: runtimeStatus.ownObservedStatus,
				staleAction: runtimeStatus.staleAction,
				issues: runtimeStatus.issues.length > 0 ? runtimeStatus.issues : undefined,
				coverage: runtimeStatus.coverage,
				computedAt: runtimeStatus.computedAt,
			};

		} catch {
			ownStatus = {
				observedStatus: 'stale',
				ownObservedStatus: 'stale',
				issues: [{ diagnostic: { code: 'metadata-broken', severity: 'error', message: 'Cognition file exists but could not be read or parsed.' }, actions: [{ label: 'Fix cognition file format' }] }],
				coverage: { ownCognition: 'not-applicable', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 0 },
			};
		}
	}

	return ownStatus;
}

function parentPlaceholder(
	parent: CoggitTreeNode,
	sourceUri: UriComponents,
): CoggitTreeNode {
	return {
		...parent,
		sourceUri,
		resourceUri: sourceUri,
	};
}

function createErrorNode(
	parent: CoggitTreeNode,
	message: string,
): CoggitTreeNode {
	return {
		id: `${parent.id}:error`,
		kind: 'error',
		label: message,
		resourceUri: parent.resourceUri,
		sourceUri: parent.sourceUri,
		relativePath: parent.relativePath,
		contextValue: 'coggitError',
		parent,
		root: parent.root,
		description: 'error',
		tooltip: message,
	};
}

function collectNode(
	node: CoggitTreeNode,
	allNodes: CoggitTreeNode[],
	nodeById: Map<string, CoggitTreeNode>,
	nodeBySourceUri: Map<string, CoggitTreeNode>,
): void {
	allNodes.push(node);
	nodeById.set(node.id, node);
	nodeBySourceUri.set(uriKey(node.sourceUri), node);
	for (const child of node.children ?? []) {
		collectNode(
			child,
			allNodes,
			nodeById,
			nodeBySourceUri,
		);
	}
}
