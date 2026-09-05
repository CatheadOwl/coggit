import * as assert from 'node:assert';
import * as vscode from 'vscode';

import type { CoggitProject, UriComponents } from '@coggit/core';
import type {
	CoggitTreeNode,
	CoggitWorkspaceRoot,
	MisplacedCognitionEntry,
	OrphanedCognitionEntry,
	StrayCognitionEntry,
	MaintenanceDiagnostic,
	UnboundCognitionEntry,
} from '@coggit/core';
import { handleSourceRenameFiles } from './sourceRename';

function uri(path: string): vscode.Uri {
	return vscode.Uri.from({
		scheme: 'test',
		authority: '',
		path,
		query: '',
		fragment: '',
	});
}

function components(path: string): UriComponents {
	return {
		scheme: 'test',
		authority: '',
		path,
		query: '',
		fragment: '',
	};
}

function makeRoot(id = 'root'): CoggitWorkspaceRoot {
	return {
		id,
		label: id,
		workspaceFolder: { uri: components('/workspace'), name: 'workspace', index: 0 },
		configUri: components('/workspace/.coggit/config.yaml'),
		projectRootUri: components('/workspace'),
		sourceRootUri: components('/workspace/src'),
		cognitionRootUri: components('/workspace/cognition'),
	};
}

function makeProject(
	applySourceRename: CoggitProject['applySourceRename'],
	root = makeRoot(),
	recordDirectoryEntryChange: CoggitProject['recordDirectoryEntryChange'] = async () => false,
): CoggitProject {
	return {
		root,
		ensureFresh: async () => {},
		buildSnapshot: async () => ({
			roots: [],
			allNodes: [],
			nodeById: new Map<string, CoggitTreeNode>(),
			nodeBySourceUri: new Map<string, CoggitTreeNode>(),
		}),
		buildCognitionRoutes: async () => ({
			project: {
				label: root.label,
				configUri: 'test:///workspace/.coggit/config.yaml',
				projectRootUri: 'test:///workspace',
				sourceRootUri: 'test:///workspace/src',
				cognitionRootUri: 'test:///workspace/cognition',
				sourceRoot: 'src',
				cognitionRoot: 'cognition',
				sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
			},
			generatedAt: 0,
			entries: [],
			diagnostics: [],
		}),
		addCognition: async () => ({
			kind: 'leaf',
			sourcePath: 'src/example.ts',
			cognitionPath: 'cognition/example.ts.md',
			cognitionUri: components('/workspace/cognition/example.ts.md'),
			created: true,
		}),
		getCognitionHandbook: () => ({
			kind: 'all',
			version: 'skeleton-leaf-v4',
			content: '',
		}),
		getCognitionTemplate: () => ({
			kind: 'leaf',
			version: 'skeleton-leaf-v4',
			content: '',
		}),
		getNode: async (): Promise<CoggitTreeNode | undefined> => undefined,
		resolveSourcePath: async (sourcePath: string) => ({ node: undefined, normalizedPath: sourcePath }),
		listUntracked: async (): Promise<CoggitTreeNode[]> => [],
		listOrphanedCognition: async (): Promise<OrphanedCognitionEntry[]> => [],
		listMisplacedCognition: async (): Promise<MisplacedCognitionEntry[]> => [],
		listStrayCognition: async (): Promise<StrayCognitionEntry[]> => [],
		listUnboundCognition: async (): Promise<UnboundCognitionEntry[]> => [],
		listMaintenanceDiagnostics: async (): Promise<MaintenanceDiagnostic[]> => [],
		moveCognitionToExpected: async (): Promise<string | undefined> => undefined,
		applySourceRename,
		recordSourceChange: async () => false,
		recordDirectoryEntryChange,
		recordCognitionChange: async () => false,
		markResolved: async () => ({ sourceKey: 'src/example.ts', verificationTimeMs: 1234 }),
		refreshNode: async (): Promise<CoggitTreeNode | undefined> => undefined,
		flush: async (): Promise<void> => {},
	};
}

suite('plugin sourceRename — source rename bridge', () => {
	test('applies source rename and schedules refresh when registry changes', async () => {
		const calls: Array<{ oldPath: string; newPath: string }> = [];
		let refreshCount = 0;
		const project = makeProject(async (oldUri, newUri) => {
			calls.push({ oldPath: oldUri.path, newPath: newUri.path });
			return true;
		});

		const changed = await handleSourceRenameFiles(
			[project],
			[{
				oldUri: uri('/workspace/src/watch'),
				newUri: uri('/workspace/src/vscode/watch'),
			}],
			() => { refreshCount++; },
		);

		assert.strictEqual(changed, true);
		assert.deepStrictEqual(calls, [{
			oldPath: '/workspace/src/watch',
			newPath: '/workspace/src/vscode/watch',
		}]);
		assert.strictEqual(refreshCount, 1);
	});

	test('records directory entry changes for both rename parents using one observation time', async () => {
		const records: Array<{ path: string; observedAtMs: number | undefined }> = [];
		let refreshCount = 0;
		const project = makeProject(
			async () => false,
			makeRoot(),
			async (uri, observedAtMs) => {
				records.push({ path: uri.path, observedAtMs });
				return true;
			},
		);

		const changed = await handleSourceRenameFiles(
			[project],
			[{
				oldUri: uri('/workspace/src/watch/foo.ts'),
				newUri: uri('/workspace/src/core/foo.ts'),
			}],
			() => { refreshCount++; },
			12345,
		);

		assert.strictEqual(changed, true);
		assert.deepStrictEqual(records, [
			{ path: '/workspace/src/watch/foo.ts', observedAtMs: 12345 },
			{ path: '/workspace/src/core/foo.ts', observedAtMs: 12345 },
		]);
		assert.strictEqual(refreshCount, 1);
	});

	test('does not schedule refresh when core reports no registry change', async () => {
		let refreshCount = 0;
		const project = makeProject(async () => false);

		const changed = await handleSourceRenameFiles(
			[project],
			[{
				oldUri: uri('/workspace/src/watch'),
				newUri: uri('/workspace/src/vscode/watch'),
			}],
			() => { refreshCount++; },
		);

		assert.strictEqual(changed, false);
		assert.strictEqual(refreshCount, 0);
	});

	test('ignores renames whose old or new URI is outside the source root', async () => {
		let applyCount = 0;
		let refreshCount = 0;
		const project = makeProject(async () => {
			applyCount++;
			return true;
		});

		const changed = await handleSourceRenameFiles(
			[project],
			[{
				oldUri: uri('/workspace/src/watch'),
				newUri: uri('/workspace/archive/watch'),
			}],
			() => { refreshCount++; },
		);

		assert.strictEqual(changed, false);
		assert.strictEqual(applyCount, 0);
		assert.strictEqual(refreshCount, 0);
	});

	test('routes a rename only to projects whose source root contains the event', async () => {
		const calls: string[] = [];
		let refreshCount = 0;
		const matching = makeProject(async () => {
			calls.push('matching');
			return true;
		});
		const other = makeProject(
			async () => {
				calls.push('other');
				return true;
			},
			{
				...makeRoot('other'),
				projectRootUri: components('/other-workspace'),
				sourceRootUri: components('/other-workspace/src'),
				cognitionRootUri: components('/other-workspace/cognition'),
			},
		);

		const changed = await handleSourceRenameFiles(
			[matching, other],
			[{
				oldUri: uri('/workspace/src/watch'),
				newUri: uri('/workspace/src/vscode/watch'),
			}],
			() => { refreshCount++; },
		);

		assert.strictEqual(changed, true);
		assert.deepStrictEqual(calls, ['matching']);
		assert.strictEqual(refreshCount, 1);
	});

	test('schedules refresh once for a batch with multiple registry changes', async () => {
		let applyCount = 0;
		let refreshCount = 0;
		const project = makeProject(async () => {
			applyCount++;
			return true;
		});

		const changed = await handleSourceRenameFiles(
			[project],
			[
				{
					oldUri: uri('/workspace/src/watch'),
					newUri: uri('/workspace/src/vscode/watch'),
				},
				{
					oldUri: uri('/workspace/src/core'),
					newUri: uri('/workspace/src/vscode/core'),
				},
			],
			() => { refreshCount++; },
		);

		assert.strictEqual(changed, true);
		assert.strictEqual(applyCount, 2);
		assert.strictEqual(refreshCount, 1);
	});
});
