import * as assert from 'node:assert';

import type { FileStat, FileSystem, UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot, PathKeyRecord } from './types';
import {
	detectOrphanedCognitionEntries,
	detectStrayCognitionEntries,
	detectUnboundCognitionEntries,
} from './maintenance';
import { discoverCognitionEntries } from './cognitionDiscovery';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

function uri(path: string): UriComponents {
	return {
		scheme: 'file',
		authority: '',
		path,
		query: '',
		fragment: '',
	};
}

function makeRoot(): CoggitWorkspaceRoot {
	return {
		id: 'root',
		label: 'workspace',
		workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
		configUri: uri('/workspace/.coggit/config.yaml'),
		projectRootUri: uri('/workspace'),
		sourceRootUri: uri('/workspace/src'),
		cognitionRootUri: uri('/workspace/cognition'),
	};
}

function makeEntry(overrides: Partial<PathKeyRecord> = {}): PathKeyRecord {
	return {
		sourcePath: 'src/missing.ts',
		type: 'leaf',
		accepted: null,
		...overrides,
	};
}

class MaintenanceTestFileSystem implements FileSystem {
	private readonly entries = new Map<string, { kind: 'file' | 'directory'; content?: string; mtimeMs: number }>();
	readDirectoryCalls: string[] = [];

	addDirectory(path: string, mtimeMs = 1000): void {
		this.entries.set(path, { kind: 'directory', mtimeMs });
	}

	addFile(path: string, content = '', mtimeMs = 1000): void {
		const parentPath = path.slice(0, path.lastIndexOf('/')) || '/';
		this.addDirectory(parentPath, mtimeMs);
		this.entries.set(path, { kind: 'file', content, mtimeMs });
	}

	async readFile(uri: UriComponents): Promise<string> {
		const entry = this.entries.get(uri.path);
		if (!entry || entry.kind !== 'file') {
			throw new Error(`ENOENT: ${uri.path}`);
		}
		return entry.content ?? '';
	}

	async writeFile(uri: UriComponents, content: string): Promise<void> {
		this.addFile(uri.path, content);
	}

	async stat(uri: UriComponents): Promise<FileStat | undefined> {
		const entry = this.entries.get(uri.path);
		if (!entry) {
			return undefined;
		}
		return {
			isDirectory: entry.kind === 'directory',
			mtimeMs: entry.mtimeMs,
		};
	}

	async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
		this.readDirectoryCalls.push(uri.path);
		const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
		const entries: Array<[string, number]> = [];
		for (const [path, entry] of this.entries) {
			if (!path.startsWith(prefix)) {
				continue;
			}
			const rest = path.slice(prefix.length);
			if (!rest || rest.includes('/')) {
				continue;
			}
			entries.push([
				rest,
				entry.kind === 'directory' ? FILE_TYPE_DIRECTORY : FILE_TYPE_FILE,
			]);
		}
		return entries;
	}

	async exists(uri: UriComponents): Promise<boolean> {
		return this.entries.has(uri.path);
	}

	async createDirectory(uri: UriComponents): Promise<void> {
		this.addDirectory(uri.path);
	}

	async delete(uri: UriComponents): Promise<void> {
		this.entries.delete(uri.path);
	}
}

suite('maintenance diagnostics', () => {
	test('reports registry-backed orphaned cognition when the source is deleted', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/missing.ts.md', 'cognition');

		const result = await detectOrphanedCognitionEntries(
			makeRoot(),
			fs,
			{ 'missing.ts': makeEntry() },
		);

		assert.strictEqual(result.length, 1);
		assert.strictEqual(result[0].registryKey, 'missing.ts');
		assert.strictEqual(result[0].sourcePath, 'src/missing.ts');
		assert.strictEqual(result[0].sourceUri.path, '/workspace/src/missing.ts');
		assert.strictEqual(result[0].cognitionPath, 'cognition/missing.ts.md');
	});

	test('does not report unregistered cognition as an orphan', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/missing.ts.md', 'cognition');

		const result = await detectOrphanedCognitionEntries(makeRoot(), fs, {});

		assert.deepStrictEqual(result, []);
	});

	test('reports unregistered tracked cognition as stray and skips generated directories', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addDirectory('/workspace/cognition');
		fs.addDirectory('/workspace/cognition/.git');
		fs.addFile('/workspace/cognition/.git/config.md');
		fs.addDirectory('/workspace/cognition/.vscode-test');
		fs.addFile('/workspace/cognition/.vscode-test/vscode-win32-x64-archive/product.md');
		fs.addDirectory('/workspace/cognition/real');
		fs.addFile('/workspace/cognition/real/missing.ts.md');
		fs.addFile('/workspace/cognition/real/CODE_MAP.md');

		const result = await detectStrayCognitionEntries(makeRoot(), fs, {});

		assert.deepStrictEqual(
			fs.readDirectoryCalls,
			['/workspace/cognition', '/workspace/cognition/real'],
		);
		assert.deepStrictEqual(
			result.map((entry) => entry.registryKey),
			['real/missing.ts'],
		);
		assert.strictEqual(result[0].cognitionPath, 'cognition/real/missing.ts.md');
	});

	test('does not report registered cognition as stray', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/real/missing.ts.md', 'cognition');

		const result = await detectStrayCognitionEntries(
			makeRoot(),
			fs,
			{ 'real/missing.ts': makeEntry({ sourcePath: 'src/real/missing.ts' }) },
		);

		assert.deepStrictEqual(result, []);
	});

	test('reports registry entries without source binding as unbound', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/rebound.ts.md', 'cognition');
		fs.addFile('/workspace/cognition/gone.ts.md', 'cognition');
		fs.addFile('/workspace/src/rebound.ts', 'source');

		const result = await detectUnboundCognitionEntries(
			makeRoot(),
			fs,
			{
				'rebound.ts': makeEntry({ sourcePath: null }),
				'gone.ts': makeEntry({ sourcePath: null }),
			},
		);

		assert.deepStrictEqual(
			result.map((entry) => entry.registryKey).sort(),
			['gone.ts', 'rebound.ts'],
		);
		const rebound = result.find((entry) => entry.registryKey === 'rebound.ts');
		const gone = result.find((entry) => entry.registryKey === 'gone.ts');
		assert.strictEqual(rebound?.sourceCandidateState, 'some-exist');
		assert.strictEqual(gone?.sourceCandidateState, 'all-missing');
		assert.strictEqual(gone?.cognitionPath, 'cognition/gone.ts.md');
	});

	test('does not report bound or unregistered cognition as unbound', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/bound.ts.md', 'cognition');
		fs.addFile('/workspace/cognition/orphaned.ts.md', 'cognition');
		fs.addFile('/workspace/cognition/unregistered.ts.md', 'cognition');

		const result = await detectUnboundCognitionEntries(
			makeRoot(),
			fs,
			{
				'bound.ts': makeEntry({ sourcePath: 'src/bound.ts' }),
				'orphaned.ts': makeEntry({ sourcePath: 'src/deleted.ts' }),
			},
		);

		assert.deepStrictEqual(result, []);
	});

	test('shared discovery avoids rescanning the cognition root', async () => {
		const fs = new MaintenanceTestFileSystem();
		fs.addFile('/workspace/cognition/real/missing.ts.md', 'cognition');

		const discovery = await discoverCognitionEntries(fs, uri('/workspace/cognition'), {
			sourceRootUri: uri('/workspace/src'),
			checkSourceCandidates: true,
		});
		const callsAfterDiscovery = fs.readDirectoryCalls.length;
		const entries = { 'real/missing.ts': makeEntry({ sourcePath: null }) };

		const stray = await detectStrayCognitionEntries(makeRoot(), fs, entries, discovery);
		const unbound = await detectUnboundCognitionEntries(
			makeRoot(),
			fs,
			entries,
			discovery,
		);

		assert.strictEqual(fs.readDirectoryCalls.length, callsAfterDiscovery);
		assert.deepStrictEqual(stray.map((entry) => entry.registryKey), []);
		assert.deepStrictEqual(unbound.map((entry) => entry.registryKey), ['real/missing.ts']);
	});
});
