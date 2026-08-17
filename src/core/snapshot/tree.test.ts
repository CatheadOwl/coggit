import * as assert from 'assert';

import { computeBlobHash } from '../hash';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '../types';
import type { FileStat, FileSystem, UriComponents } from '../interfaces';
import { buildFileNode, buildFolderNode, buildProjectSnapshot } from './tree';

suite('folder node freshness fallback', () => {
	interface MockEntry {
		isDirectory: boolean;
		mtimeMs: number;
		content?: string;
	}

	class MockFileSystem implements FileSystem {
		private entries = new Map<string, MockEntry>();

		addFile(path: string, mtimeMs = 1000, content?: string): void {
			this.entries.set(path, { isDirectory: false, mtimeMs, content });
		}

		addDirectory(path: string, mtimeMs = 1000): void {
			this.entries.set(path, { isDirectory: true, mtimeMs });
		}

		async stat(uri: UriComponents): Promise<FileStat | undefined> {
			const entry = this.entries.get(uri.path);
			if (!entry) {
				return undefined;
			}
			return { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs };
		}

		async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
			const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
			const result: Array<[string, number]> = [];
			for (const [key, entry] of this.entries) {
				if (key.startsWith(prefix) && key !== uri.path) {
					const rest = key.slice(prefix.length);
					if (rest.includes('/')) {
						continue;
					}
					result.push([rest, entry.isDirectory ? 2 : 1]);
				}
			}
			return result.sort(([a], [b]) => a.localeCompare(b));
		}

		async readFile(uri: UriComponents): Promise<string> {
			const entry = this.entries.get(uri.path);
			if (!entry || entry.isDirectory) {
				throw new Error('ENOENT');
			}
			return entry.content ?? '';
		}

		async exists(uri: UriComponents): Promise<boolean> {
			return this.entries.has(uri.path);
		}

		async writeFile(_uri: UriComponents, _content: string): Promise<void> {}
		async createDirectory(_uri: UriComponents): Promise<void> {}
		async delete(_uri: UriComponents): Promise<void> {}
	}

	function mkUri(path: string): UriComponents {
		return { scheme: 'file', authority: '', path, query: '', fragment: '' };
	}

	function mkRoot(overrides?: Partial<CoggitWorkspaceRoot>): CoggitWorkspaceRoot {
		return {
			id: 'test-root',
			label: 'test',
			workspaceFolder: { uri: mkUri('/workspace'), name: 'test', index: 0 },
			configUri: mkUri('/workspace/.coggit/config.yaml'),
			projectRootUri: mkUri('/workspace'),
			sourceRootUri: mkUri('/workspace/src'),
			cognitionRootUri: mkUri('/workspace/cog'),
			...overrides,
		};
	}

	function mkPlaceholderParent(root: CoggitWorkspaceRoot, sourceUri: UriComponents): CoggitTreeNode {
		return {
			id: 'root',
			kind: 'root',
			label: 'root',
			resourceUri: sourceUri,
			sourceUri,
			relativePath: '.',
			contextValue: 'coggitRoot',
			root,
			children: [],
		};
	}

	test('buildFileNode populates projected status for present cognition', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const fileUri = mkUri('/workspace/src/foo/bar.ts');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addFile('/workspace/src/foo/bar.ts', 2000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/bar.ts.md', 1000, '# Bar\n\nContent.\n\nMore details.');

		const parent = mkPlaceholderParent(root, mkUri('/workspace/src/foo'));
		const node = await buildFileNode(parent, fileUri, sourceRootUri, fs);

		assert.strictEqual(node.status?.observedStatus, 'fresh');
		assert.strictEqual(node.status?.coverage?.ownCognition, 'present');
		assert.strictEqual(node.status?.coverage?.isMaterializable, false);
	});

	test('buildFileNode does not mark passive fresh status as verified evidence', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const fileUri = mkUri('/workspace/src/foo/bar.ts');
		const sourceRootUri = mkUri('/workspace/src');
		let explicitVerificationCount = 0;

		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/bar.ts.md', 2000,
			'# Bar\n\nThis cognition already describes the tracked bar source file with enough maintained prose to avoid skeleton detection.\n\nIt represents the current source behavior.');

		const parent = mkPlaceholderParent(root, mkUri('/workspace/src/foo'));
		const node = await buildFileNode(
			parent,
			fileUri,
			sourceRootUri,
			fs,
			{
				freshnessEvidence: {
					getFreshnessTimes: () => ({
						sourceFactMtimeMs: null,
						cognitionMtimeMs: null,
						verificationTimeMs: null,
						sourceFactHash: null,
					}),
					recordSourceFactTime: () => {},
					recordCognitionTime: () => {},
					recordExplicitVerification: () => {
						explicitVerificationCount += 1;
					},
				},
			},
		);

		assert.strictEqual(node.status?.observedStatus, 'fresh');
		assert.strictEqual(explicitVerificationCount, 0);
	});

	test('buildFileNode marks missing cognition as materializable without observed status', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const fileUri = mkUri('/workspace/src/foo/missing.ts');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addFile('/workspace/src/foo/missing.ts', 2000, 'export const missing = true;');

		const parent = mkPlaceholderParent(root, mkUri('/workspace/src/foo'));
		const node = await buildFileNode(parent, fileUri, sourceRootUri, fs);

		assert.strictEqual(node.status?.observedStatus, undefined);
		assert.deepStrictEqual(node.status?.issues?.map((issue) => issue.diagnostic.code), ['missing-cognition']);
		assert.deepStrictEqual(node.status?.issues?.[0]?.actions.map((action) => action.label), ['Create cognition file']);
		assert.strictEqual(node.status?.coverage?.ownCognition, 'missing');
		assert.strictEqual(node.status?.coverage?.isMaterializable, true);
		assert.strictEqual(node.status?.coverage?.missingMaterializableCount, 1);
	});

	test('folder without README and all children untracked', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/test');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/test');
		fs.addFile('/workspace/src/test/foo.test.ts');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.ownObservedStatus, undefined);
		assert.strictEqual(node.status?.descendantObservedStatus, undefined);
		assert.strictEqual(node.status?.observedStatus, undefined);
		assert.strictEqual(node.status?.coverage?.ownCognition, 'missing');
		assert.strictEqual(node.status?.coverage?.isMaterializable, true);
		assert.strictEqual(node.status?.coverage?.missingMaterializableCount, 1);
	});

	test('folder without README but fresh tracked descendant projects fresh observed status', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/foo');
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/bar.ts.md', 2000,
			'# Bar\n\nThis cognition describes the tracked bar source file in detail with enough substantive prose to avoid skeleton detection.\n\nIt represents actual maintained cognition coverage.');
		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.observedStatus, 'fresh');
		assert.strictEqual(node.status?.ownObservedStatus, undefined);
		assert.strictEqual(node.status?.descendantObservedStatus, 'fresh');
		assert.strictEqual(node.status?.observedStatus, 'fresh');
		assert.strictEqual(node.status?.coverage?.ownCognition, 'missing');
		assert.strictEqual(node.status?.coverage?.isMaterializable, true);
	});

	test('folder with skeleton README and all children untracked is stale', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/test');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/test');
		fs.addFile('/workspace/src/test/foo.test.ts');
		fs.addFile('/workspace/cog/test/README.md');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.observedStatus, 'stale');
	});

	test('folder without README but has tracked stale child is stale', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/foo');
		fs.addFile('/workspace/src/foo/bar.ts', 2000);
		fs.addFile('/workspace/cog/foo/bar.ts.md', 1000,
			'# Bar\n\nThis stale cognition still contains enough substantive documentation body to avoid skeleton detection.\n\nIt remains older than the paired source file.');
		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.descendantObservedStatus, 'fresh');
		assert.strictEqual(node.status?.observedStatus, 'fresh');
	});

	test('folder with skeleton README and fresh descendant projects own stale status', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/README.md', 2000, '# Foo');
		fs.addFile('/workspace/cog/foo/bar.ts.md', 2000,
			'# Bar\n\nThis cognition describes the tracked bar source file in detail with enough substantive prose to avoid skeleton detection.\n\nIt represents actual maintained cognition coverage.');
		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.ownObservedStatus, 'stale');
		assert.strictEqual(node.status?.descendantObservedStatus, 'fresh');
		assert.strictEqual(node.status?.observedStatus, 'stale');
		assert.strictEqual(node.status?.coverage?.ownCognition, 'present');
		assert.strictEqual(node.status?.issues?.some((issue) => issue.diagnostic.code === 'template-cognition'), true);
	});

	test('folder structural fingerprint mismatch reports own structure issue', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');
		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addDirectory('/workspace/src/foo/baz', 1000);
		fs.addFile('/workspace/cog/foo/README.md', 2000,
			'# Foo\n\nThis folder README documents the module boundary and child layout.\n\nIt is maintained cognition content.');
		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent,
			folderUri,
			sourceRootUri,
			{ rules: [] },
			fs,
			{
				freshnessEvidence: {
					getFreshnessTimes: (_rootId, sourceKey) => ({
						sourceFactMtimeMs: null,
						cognitionMtimeMs: null,
						verificationTimeMs: sourceKey === 'foo/' ? 3000 : null,
						sourceFactHash: null,
					}),
					recordSourceFactTime: () => {},
					recordCognitionTime: () => {},
					recordExplicitVerification: () => {},
				},
			},
		);

		assert.strictEqual(node.ownStatus?.observedStatus, 'fresh');
		assert.strictEqual(node.status?.observedStatus, 'fresh');
	});

	test('folder reviewed current fingerprint can be fresh without README edit', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');
		let explicitVerificationCount = 0;

		fs.addDirectory('/workspace/src/foo', 3000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/README.md', 1000,
			'# Foo\n\nThis stable folder README documents the module boundary.\n\nIt remains valid without a text edit.');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent,
			folderUri,
			sourceRootUri,
			{ rules: [] },
			fs,
			{
				freshnessEvidence: {
					getFreshnessTimes: () => ({
						sourceFactMtimeMs: null,
						cognitionMtimeMs: null,
						verificationTimeMs: 4000,
						sourceFactHash: null,
					}),
					recordSourceFactTime: () => {},
					recordCognitionTime: () => {},
					recordExplicitVerification: () => {
						explicitVerificationCount += 1;
					},
				},
			},
		);

		assert.strictEqual(node.ownStatus?.observedStatus, 'fresh');
		assert.strictEqual(explicitVerificationCount, 0);
	});

	test('folder directory mtime noise does not make unchanged structure stale', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');
		const currentHash = computeBlobHash('bar.ts');
		const records: Array<{ sourceKey: string; mtimeMs: number }> = [];

		fs.addDirectory('/workspace/src/foo', 3000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/README.md', 2000,
			'# Foo\n\nThis maintained folder README describes the direct child structure.\n\nIt is still current.');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent,
			folderUri,
			sourceRootUri,
			{ rules: [] },
			fs,
			{
				freshnessEvidence: {
					getFreshnessTimes: () => ({
						sourceFactMtimeMs: 1000,
						cognitionMtimeMs: 2000,
						verificationTimeMs: null,
						sourceFactHash: currentHash,
					}),
					recordSourceFactTime: (_rootId, sourceKey, mtimeMs) => {
						records.push({ sourceKey, mtimeMs });
					},
					recordCognitionTime: () => {},
					recordExplicitVerification: () => {},
				},
			},
		);

		assert.strictEqual(node.ownStatus?.observedStatus, 'fresh');
		assert.deepStrictEqual(records.filter((record) => record.sourceKey === 'foo/'), []);
	});

	test('folder direct-child fingerprint change advances folder source fact observation', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');
		const originalNow = Date.now;
		const records: Array<{
			sourceKey: string;
			mtimeMs: number;
			sourceFactHash?: string | null;
		}> = [];

		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addDirectory('/workspace/src/foo/baz', 1000);
		fs.addFile('/workspace/cog/foo/README.md', 2000,
			'# Foo\n\nThis maintained folder README described an older direct child structure.\n\nIt now needs review.');

		Date.now = () => 3000;
		try {
			const parent = mkPlaceholderParent(root, folderUri);
			const node = await buildFolderNode(
				parent,
				folderUri,
				sourceRootUri,
				{ rules: [] },
				fs,
				{
					freshnessEvidence: {
						getFreshnessTimes: () => ({
							sourceFactMtimeMs: 1000,
							cognitionMtimeMs: 2000,
							verificationTimeMs: null,
							sourceFactHash: computeBlobHash('bar.ts'),
						}),
						recordSourceFactTime: (_rootId, sourceKey, mtimeMs, sourceFactHash) => {
							records.push({ sourceKey, mtimeMs, sourceFactHash });
						},
						recordCognitionTime: () => {},
						recordExplicitVerification: () => {},
					},
				},
			);

			assert.strictEqual(node.ownStatus?.observedStatus, 'fresh');
			assert.deepStrictEqual(records.filter((record) => record.sourceKey === 'foo/'), []);
		} finally {
			Date.now = originalNow;
		}
	});

	test('folder ignores generated directories in structure and fingerprinting', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addDirectory('/workspace/src/foo/__pycache__', 1000);
		fs.addFile('/workspace/src/foo/__pycache__/bar.cpython-311.pyc', 1000, 'compiled');
		fs.addDirectory('/workspace/src/foo/.pytest_cache', 1000);
		fs.addFile('/workspace/src/foo/.pytest_cache/README.md', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.mypy_cache', 1000);
		fs.addFile('/workspace/src/foo/.mypy_cache/meta.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/.ruff_cache', 1000);
		fs.addFile('/workspace/src/foo/.ruff_cache/cache', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.tox', 1000);
		fs.addFile('/workspace/src/foo/.tox/config', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.nox', 1000);
		fs.addFile('/workspace/src/foo/.nox/session', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.parcel-cache', 1000);
		fs.addFile('/workspace/src/foo/.parcel-cache/data', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.turbo', 1000);
		fs.addFile('/workspace/src/foo/.turbo/run.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/.next', 1000);
		fs.addFile('/workspace/src/foo/.next/build-manifest.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/.nuxt', 1000);
		fs.addFile('/workspace/src/foo/.nuxt/manifest.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/.svelte-kit', 1000);
		fs.addFile('/workspace/src/foo/.svelte-kit/generated.js', 1000, 'export {};');
		fs.addDirectory('/workspace/src/foo/.vite', 1000);
		fs.addFile('/workspace/src/foo/.vite/deps.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/.cache', 1000);
		fs.addFile('/workspace/src/foo/.cache/data', 1000, 'cache');
		fs.addDirectory('/workspace/src/foo/.git', 1000);
		fs.addFile('/workspace/src/foo/.git/config', 1000, 'gitdir: elsewhere');
		fs.addDirectory('/workspace/src/foo/.vscode-test', 1000);
		fs.addFile('/workspace/src/foo/.vscode-test/vscode-win32-x64-archive/product.json', 1000, '{}');
		fs.addDirectory('/workspace/src/foo/node_modules', 1000);
		fs.addFile('/workspace/src/foo/node_modules/library.js', 1000, 'module.exports = {};');
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/README.md', 2000,
			'# Foo\n\nThis maintained folder README describes the direct child structure.\n\nIt is still current.');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent,
			folderUri,
			sourceRootUri,
			{ rules: [] },
			fs,
		);

		assert.deepStrictEqual(
			(node.children ?? []).map((child) => child.label),
			['bar.ts'],
		);
	});

	test('folder first source-fact observation preserves accepted time when hash is missing', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/foo');
		const sourceRootUri = mkUri('/workspace/src');
		const originalNow = Date.now;
		const records: Array<{
			sourceKey: string;
			mtimeMs: number;
			sourceFactHash?: string | null;
		}> = [];

		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/foo/README.md', 2000,
			'# Foo\n\nThis maintained folder README describes the accepted direct child structure.\n\nIt only needs its passive source-fact hash initialized.');

		Date.now = () => 3000;
		try {
			const parent = mkPlaceholderParent(root, folderUri);
			const node = await buildFolderNode(
				parent,
				folderUri,
				sourceRootUri,
				{ rules: [] },
				fs,
				{
					freshnessEvidence: {
						getFreshnessTimes: () => ({
							sourceFactMtimeMs: null,
							cognitionMtimeMs: 2000,
							verificationTimeMs: null,
							sourceFactHash: null,
						}),
						recordSourceFactTime: (_rootId, sourceKey, mtimeMs, sourceFactHash) => {
							records.push({ sourceKey, mtimeMs, sourceFactHash });
						},
						recordCognitionTime: () => {},
						recordExplicitVerification: () => {},
					},
				},
			);

			assert.strictEqual(node.ownStatus?.observedStatus, 'fresh');
			assert.deepStrictEqual(records.filter((record) => record.sourceKey === 'foo/'), []);
		} finally {
			Date.now = originalNow;
		}
	});

	test('root directory mtime noise does not advance unchanged structure source fact', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const currentHash = computeBlobHash('foo/');
		const records: Array<{ sourceKey: string; mtimeMs: number }> = [];

		fs.addDirectory('/workspace/src', 3000);
		fs.addDirectory('/workspace/src/foo', 1000);
		fs.addFile('/workspace/src/foo/bar.ts', 1000, 'export const bar = 1;');
		fs.addFile('/workspace/cog/README.md', 2000,
			'# Root\n\nThis maintained root cognition describes the direct child structure.\n\nIt is still current.');

		const snapshot = await buildProjectSnapshot(
			root,
			fs,
			{
				freshnessEvidence: {
					getFreshnessTimes: (_rootId, sourceKey) => sourceKey === '/'
						? {
								sourceFactMtimeMs: 1000,
								cognitionMtimeMs: 2000,
								verificationTimeMs: null,
								sourceFactHash: currentHash,
							}
						: {
								sourceFactMtimeMs: null,
								cognitionMtimeMs: null,
								verificationTimeMs: null,
								sourceFactHash: null,
							},
					recordSourceFactTime: (_rootId, sourceKey, mtimeMs) => {
						records.push({ sourceKey, mtimeMs });
					},
					recordCognitionTime: () => {},
					recordExplicitVerification: () => {},
				},
			},
		);

		assert.strictEqual(snapshot.roots[0].ownStatus?.observedStatus, 'fresh');
		assert.deepStrictEqual(records.filter((record) => record.sourceKey === '/'), []);
	});

	test('empty folder with no cognition has no observed status', async () => {
		const root = mkRoot();
		const fs = new MockFileSystem();
		const folderUri = mkUri('/workspace/src/empty');
		const sourceRootUri = mkUri('/workspace/src');

		fs.addDirectory('/workspace/src/empty');

		const parent = mkPlaceholderParent(root, folderUri);
		const node = await buildFolderNode(
			parent, folderUri, sourceRootUri, { rules: [] }, fs,
		);

		assert.strictEqual(node.status?.observedStatus, undefined);
	});
});
