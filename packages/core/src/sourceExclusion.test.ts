import * as assert from 'node:assert';

import type { CoggitWorkspaceRoot } from './types';
import type { FileStat, FileSystem, UriComponents } from './interfaces';
import {
	COGGIT_SOURCE_PRESETS,
	createSourceExclusion,
	SOURCE_DISCOVERY_SKIP_DIRECTORIES,
	sourceDiscoveryExcludeGlobPatterns,
} from './sourceExclusion';

suite('source exclusion (pathscope engine)', () => {
	interface MockEntry {
		isDirectory: boolean;
		mtimeMs: number;
		content?: string;
	}

	class MockFileSystem implements FileSystem {
		private entries = new Map<string, MockEntry>();

		addFile(path: string, content = ''): void {
			this.entries.set(path, { isDirectory: false, mtimeMs: 1000, content });
		}

		addDirectory(path: string): void {
			this.entries.set(path, { isDirectory: true, mtimeMs: 1000 });
		}

		async stat(uri: UriComponents): Promise<FileStat | undefined> {
			const entry = this.entries.get(uri.path);
			return entry ? { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs } : undefined;
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
			projectRootUri: mkUri('/workspace/project'),
			sourceRootUri: mkUri('/workspace/project/src'),
			cognitionRootUri: mkUri('/workspace/project/cognition'),
			...overrides,
		};
	}

	test('mounts the coggit preset set with cache trees and colliding build names excluded as directories', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		for (const name of ['node_modules', 'vendor', 'dist', 'build', 'lib', 'out', 'coverage', '.pnpm', '__pycache__', '.cache', '.next', '.vscode-test']) {
			fs.addDirectory(`/workspace/project/src/${name}`);
		}
		// Same-name files stay indexable (dir-only patterns).
		fs.addFile('/workspace/project/src/lib');
		fs.addFile('/workspace/project/src/dist');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		for (const name of ['node_modules', 'vendor', 'dist', 'build', 'lib', 'out', 'coverage', '.pnpm', '__pycache__', '.cache', '.next', '.vscode-test']) {
			assert.strictEqual(await exclusion.excludes(mkUri(`/workspace/project/src/${name}`), true), true, `${name}/ excluded`);
		}
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/lib'), false), false, 'plain file named lib');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/dist'), false), false, 'plain file named dist');
	});

	test('a named gitignore negation rescues colliding names — source under lib/ or vendor/ is indexable again', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		fs.addFile('/workspace/project/src/.gitignore', '!lib/\n!vendor/\n');
		fs.addDirectory('/workspace/project/src/lib');
		fs.addFile('/workspace/project/src/lib/engine.ts');
		fs.addDirectory('/workspace/project/src/vendor');
		fs.addFile('/workspace/project/src/vendor/adapter.ts');
		fs.addDirectory('/workspace/project/src/dist');
		fs.addFile('/workspace/project/src/dist/bundle.js');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		await exclusion.foldDirectory(mkUri('/workspace/project/src'));
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/lib'), true), false, '!lib/ rescues the build preset');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/lib/engine.ts'), false), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendor'), true), false, '!vendor/ rescues the deps preset');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendor/adapter.ts'), false), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/dist'), true), true, 'non-negated preset still excluded');
	});

	test('nested .git descends under the scanner alignment face (declaration-as-registration)', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		fs.addDirectory('/workspace/project/src/vendored-lib');
		fs.addFile('/workspace/project/src/vendored-lib/.git', 'gitdir: ../../.git/worktrees/x\n');
		fs.addDirectory('/workspace/project/src/vendored-lib/inner');
		fs.addFile('/workspace/project/src/vendored-lib/inner/a.ts');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		// 2026-10-30 adjudication (decision 0002): the source-root declaration
		// is the registration — nested repositories descend, report-not-cut.
		// These assertions also pin the bridge's array-form discipline: the
		// engine's boolean stoneHit truncates unconditionally under every
		// face, so a bridge regression back to boolean turns them red.
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib'), true), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib/inner'), true), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib/inner/a.ts'), false), false);
		// A deeper embedded .git descends too — any depth, the depth the
		// exempt key cannot express.
		fs.addDirectory('/workspace/project/src/vendored-lib/inner/nested-repo');
		fs.addFile('/workspace/project/src/vendored-lib/inner/nested-repo/.git', 'gitdir: ../../.git/worktrees/y\n');
		fs.addFile('/workspace/project/src/vendored-lib/inner/nested-repo/b.ts');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib/inner/nested-repo'), true), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib/inner/nested-repo/b.ts'), false), false);
		// The gitdir pointer is a FILE — the vcs preset's name semantics are
		// directory-only, so it is admitted like any dotfile (the retired
		// engine's behavior; a directory named .git keeps its vcs exclusion).
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/vendored-lib/.git'), false), false);
		// The source root itself never truncates via the stone — the guard is
		// on the root key.
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src'), true), false);
	});

	test('a directory named .git is excluded by the vcs preset (name semantics)', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		fs.addDirectory('/workspace/project/src/foo');
		fs.addDirectory('/workspace/project/src/foo/.git');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/foo/.git'), true), true);
	});

	test('project-root gitignore applies above the source root, inherited through the .git anchor', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addFile('/workspace/project/.git', 'gitdir: /elsewhere\n');
		fs.addFile('/workspace/project/.gitignore', 'generated/\n');
		fs.addDirectory('/workspace/project/src');
		fs.addDirectory('/workspace/project/src/generated');
		fs.addFile('/workspace/project/src/generated/x.ts');
		fs.addFile('/workspace/project/src/keep.ts');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/generated'), true), true, 'inherited rule from project root');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/keep.ts'), false), false);
	});

	test('dot entries stay indexable (no blanket dot category)', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		fs.addFile('/workspace/project/src/.gitignore', 'dist/\n');
		fs.addFile('/workspace/project/src/.env');
		fs.addDirectory('/workspace/project/src/.github');
		fs.addFile('/workspace/project/src/.github/workflows.yml');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/.env'), false), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/.github'), true), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/.github/workflows.yml'), false), false);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/.gitignore'), false), false);
	});

	test('nested gitignore folds on descent and a deeper negation wins', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');
		fs.addFile('/workspace/project/src/.gitignore', 'tmp/\n');
		fs.addDirectory('/workspace/project/src/pkg');
		fs.addFile('/workspace/project/src/pkg/.gitignore', '!tmp/\n');
		fs.addDirectory('/workspace/project/src/pkg/tmp');
		fs.addFile('/workspace/project/src/pkg/tmp/keep.ts');
		fs.addDirectory('/workspace/project/src/tmp');
		fs.addFile('/workspace/project/src/tmp/skip.ts');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/tmp'), true), true, 'root layer rule');
		await exclusion.foldDirectory(mkUri('/workspace/project/src/pkg'));
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src/pkg/tmp'), true), false, 'deeper ! wins after fold');
	});

	test('coggit mounts vcs, deps, build, and caches presets', () => {
		assert.deepEqual([...COGGIT_SOURCE_PRESETS], ['vcs', 'deps', 'build', 'caches']);
	});

	test('discovery skip set carries the mounted preset directory names only', () => {
		for (const name of ['.git', '.hg', '.svn', 'node_modules', '.pnpm', 'vendor', 'dist', 'build', 'lib', 'out', 'coverage', '__pycache__', '.cache', '.next', '.vscode-test']) {
			assert.ok(SOURCE_DISCOVERY_SKIP_DIRECTORIES.has(name), `${name} in skip set`);
		}
		assert.ok(!SOURCE_DISCOVERY_SKIP_DIRECTORIES.has('src'));
		assert.ok(!SOURCE_DISCOVERY_SKIP_DIRECTORIES.has('packages'));
		const patterns = sourceDiscoveryExcludeGlobPatterns();
		assert.ok(patterns.includes('**/node_modules/**'));
		assert.ok(patterns.includes('**/.git/**'));
		assert.ok(patterns.every((pattern) => pattern.startsWith('**/') && pattern.endsWith('/**')));
	});

	test('excludes() ignores entries outside the source root and the root itself', async () => {
		const fs = new MockFileSystem();
		fs.addDirectory('/workspace/project');
		fs.addDirectory('/workspace/project/src');

		const exclusion = await createSourceExclusion(mkRoot(), fs);
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/other'), true), false, 'outside the source root');
		assert.strictEqual(await exclusion.excludes(mkUri('/workspace/project/src'), true), false, 'the source root itself');
	});
});
