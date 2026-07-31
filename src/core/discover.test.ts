import * as assert from 'assert';

import { findProjectRoot } from './discover';
import type { FileStat, FileSystem, UriComponents } from './interfaces';

suite('root discovery', () => {
	class MockFs implements FileSystem {
		private readonly dirs = new Set<string>();
		private readonly files = new Set<string>();

		addDir(p: string): void { this.dirs.add(p); }
		addFile(p: string): void { this.files.add(p); }
		async readFile(_uri: UriComponents): Promise<string> { throw new Error('not implemented'); }
		async writeFile(_uri: UriComponents, _content: string): Promise<void> { throw new Error('not implemented'); }
		async readDirectory(_uri: UriComponents): Promise<Array<[string, number]>> { throw new Error('not implemented'); }
		async createDirectory(_uri: UriComponents): Promise<void> { throw new Error('not implemented'); }
		async delete(uri: UriComponents): Promise<void> { this.files.delete(uri.path); }
		async stat(_uri: UriComponents): Promise<FileStat | undefined> { throw new Error('not implemented'); }
		async exists(uri: UriComponents): Promise<boolean> {
			return this.files.has(uri.path) || this.dirs.has(uri.path);
		}
	}

	function uri(p: string): UriComponents {
		return { scheme: 'file', authority: '', path: p, query: '', fragment: '' };
	}

	test('finds config.yaml from a source file path', async () => {
		const fs = new MockFs();
		fs.addDir('/workspace/project');
		fs.addDir('/workspace/project/.coggit');
		fs.addFile('/workspace/project/.coggit/config.yaml');

		const result = await findProjectRoot(uri('/workspace/project/src/foo.ts'), fs);
		assert.ok(result, 'should find project root');
		assert.strictEqual(result!.projectRootUri.path, '/workspace/project');
		assert.strictEqual(result!.configUri.path, '/workspace/project/.coggit/config.yaml');
	});

	test('returns undefined when no .coggit/config.yaml exists', async () => {
		const fs = new MockFs();
		fs.addDir('/workspace/other');

		const result = await findProjectRoot(uri('/workspace/other/file.ts'), fs);
		assert.strictEqual(result, undefined);
	});

	test('nearest root wins in nested monorepo', async () => {
		const fs = new MockFs();
		fs.addDir('/workspace');
		fs.addDir('/workspace/.coggit');
		fs.addFile('/workspace/.coggit/config.yaml');
		fs.addDir('/workspace/packages');
		fs.addDir('/workspace/packages/a');
		fs.addDir('/workspace/packages/a/.coggit');
		fs.addFile('/workspace/packages/a/.coggit/config.yaml');

		const result = await findProjectRoot(uri('/workspace/packages/a/src/lib.ts'), fs);
		assert.ok(result, 'should find innermost root');
		assert.strictEqual(result!.projectRootUri.path, '/workspace/packages/a');
	});

	test('skips .coggit directory itself when starting inside it', async () => {
		const fs = new MockFs();
		fs.addDir('/workspace/project');
		fs.addDir('/workspace/project/.coggit');
		fs.addFile('/workspace/project/.coggit/config.yaml');

		const result = await findProjectRoot(uri('/workspace/project/.coggit/registry.yaml'), fs);
		assert.ok(result, 'should skip .coggit itself and find parent root');
		assert.strictEqual(result!.projectRootUri.path, '/workspace/project');
	});

	test('maxWalkDepth prevents infinite walk', async () => {
		const fs = new MockFs();

		const result = await findProjectRoot(
			uri('/a/b/c/d/e/f/g/h/i/j/k/l/m.ts'),
			fs,
			{ maxWalkDepth: 5 },
		);
		assert.strictEqual(result, undefined);
	});

	test('starts with directory URI', async () => {
		const fs = new MockFs();
		fs.addDir('/workspace/project/src');
		fs.addDir('/workspace/project/.coggit');
		fs.addFile('/workspace/project/.coggit/config.yaml');

		const result = await findProjectRoot(uri('/workspace/project/src/'), fs);
		assert.ok(result);
		assert.strictEqual(result!.projectRootUri.path, '/workspace/project');
	});

	test('drops to root without finding config', async () => {
		const fs = new MockFs();
		fs.addDir('/');
		fs.addDir('/workspace');

		const result = await findProjectRoot(uri('/workspace/file.ts'), fs);
		assert.strictEqual(result, undefined);
	});
});
