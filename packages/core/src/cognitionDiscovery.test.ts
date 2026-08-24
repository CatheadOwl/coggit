import * as assert from 'node:assert';

import { discoverCognitionEntries } from './cognitionDiscovery';
import type { FileStat, FileSystem, UriComponents } from './interfaces';

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

class DiscoveryTestFileSystem implements FileSystem {
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
		return entries.sort(([a], [b]) => a.localeCompare(b));
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

suite('cognition discovery', () => {
	test('discovers only source-paired cognition markdown', async () => {
		const fs = new DiscoveryTestFileSystem();
		fs.addFile('/workspace/cognition/README.md');
		fs.addFile('/workspace/cognition/feature/README.md');
		fs.addFile('/workspace/cognition/feature/model.ts.md');
		fs.addFile('/workspace/cognition/feature/CODE_MAP.md');
		fs.addFile('/workspace/cognition/feature/MODULES.md');
		fs.addFile('/workspace/cognition/feature/raw.md');
		fs.addFile('/workspace/cognition/feature/model.txt');

		const result = await discoverCognitionEntries(
			fs,
			uri('/workspace/cognition'),
			{ sourceRootUri: uri('/workspace/src') },
		);

		assert.deepStrictEqual(
			[...result.keys()].sort(),
			['/', 'feature/', 'feature/model.ts'],
		);
		assert.strictEqual(result.get('/')?.type, 'folder');
		assert.strictEqual(result.get('feature/')?.cognitionPath, 'feature/README.md');
		assert.strictEqual(result.get('feature/model.ts')?.type, 'leaf');
		assert.deepStrictEqual(
			result.get('feature/model.ts')?.sourceCandidateUris.map((candidate) => candidate.path),
			['/workspace/src/feature/model.ts'],
		);
	});

	test('can skip generated directories before recursing', async () => {
		const fs = new DiscoveryTestFileSystem();
		fs.addDirectory('/workspace/cognition');
		fs.addFile('/workspace/cognition/.git/config.ts.md');
		fs.addFile('/workspace/cognition/real/config.ts.md');

		const result = await discoverCognitionEntries(
			fs,
			uri('/workspace/cognition'),
			{ shouldSkipDirectory: (name) => name === '.git' },
		);

		assert.deepStrictEqual(fs.readDirectoryCalls, [
			'/workspace/cognition',
			'/workspace/cognition/real',
		]);
		assert.deepStrictEqual([...result.keys()].sort(), ['real/config.ts']);
	});

	test('checks inferred source candidate state when requested', async () => {
		const fs = new DiscoveryTestFileSystem();
		fs.addFile('/workspace/cognition/existing.ts.md');
		fs.addFile('/workspace/cognition/missing.ts.md');
		fs.addFile('/workspace/src/existing.ts');

		const result = await discoverCognitionEntries(
			fs,
			uri('/workspace/cognition'),
			{
				sourceRootUri: uri('/workspace/src'),
				checkSourceCandidates: true,
			},
		);

		assert.strictEqual(result.get('existing.ts')?.sourceCandidateState, 'some-exist');
		assert.strictEqual(result.get('missing.ts')?.sourceCandidateState, 'all-missing');
	});

	test('keeps folder cognition candidate state unchecked', async () => {
		const fs = new DiscoveryTestFileSystem();
		fs.addFile('/workspace/cognition/pkg/README.md');
		fs.addDirectory('/workspace/src/pkg');

		const result = await discoverCognitionEntries(
			fs,
			uri('/workspace/cognition'),
			{
				sourceRootUri: uri('/workspace/src'),
				checkSourceCandidates: true,
			},
		);

		const entry = result.get('pkg/');
		assert.strictEqual(entry?.type, 'folder');
		assert.strictEqual(entry?.sourceCandidateState, 'unchecked');
	});

	test('reports unchecked when no source candidate is inferrable', async () => {
		const fs = new DiscoveryTestFileSystem();
		fs.addFile('/workspace/cognition/.hidden.ts.md');

		const result = await discoverCognitionEntries(
			fs,
			uri('/workspace/cognition'),
			{
				sourceRootUri: uri('/workspace/src'),
				checkSourceCandidates: true,
			},
		);

		assert.deepStrictEqual(result.get('.hidden.ts')?.sourceCandidateUris, []);
		assert.strictEqual(result.get('.hidden.ts')?.sourceCandidateState, 'unchecked');
	});
});
