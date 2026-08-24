import * as assert from 'assert';

import { initProject } from './init';
import type { FileStat, FileSystem, UriComponents } from '../interfaces';

suite('project init', () => {
	class MockFs implements FileSystem {
		private readonly dirs = new Set<string>();
		private readonly files = new Map<string, string>();

		async readFile(uri: UriComponents): Promise<string> {
			const content = this.files.get(uri.path);
			if (content === undefined) {
				throw new Error('ENOENT');
			}
			return content;
		}

		async writeFile(uri: UriComponents, content: string): Promise<void> {
			this.files.set(uri.path, content);
		}

		async readDirectory(_uri: UriComponents): Promise<Array<[string, number]>> { return []; }
		async createDirectory(uri: UriComponents): Promise<void> { this.dirs.add(uri.path); }
		async delete(uri: UriComponents): Promise<void> { this.files.delete(uri.path); }
		async stat(uri: UriComponents): Promise<FileStat | undefined> {
			if (this.dirs.has(uri.path)) {
				return { isDirectory: true, mtimeMs: 0 };
			}
			if (this.files.has(uri.path)) {
				return { isDirectory: false, mtimeMs: 0 };
			}
			return undefined;
		}
		async exists(uri: UriComponents): Promise<boolean> {
			return this.files.has(uri.path) || this.dirs.has(uri.path);
		}
	}

	function uri(p: string): UriComponents {
		return { scheme: 'file', authority: '', path: p, query: '', fragment: '' };
	}

	test('creates a bootstrap README in the cognition root', async () => {
		const fs = new MockFs();

		await initProject(fs, uri('/workspace/project'), {
			sourceRoot: 'src',
			cognitionRoot: 'src_cognition',
		});

		const readme = await fs.readFile(uri('/workspace/project/src_cognition/README.md'));
		assert.match(readme, /^# CogGit Cognition/);
		assert.match(readme, /does not yet contain reliable project knowledge/);
		assert.match(readme, /snapshot operation/);
		assert.match(readme, /add operation/);
		assert.match(readme, /handbook returned/);
		assert.match(readme, /status operation/);
		assert.doesNotMatch(readme, /coggit_\w+/);
	});

	test('does not overwrite an existing cognition README', async () => {
		const fs = new MockFs();
		await fs.writeFile(uri('/workspace/project/docs/README.md'), '# Existing\n');

		await initProject(fs, uri('/workspace/project'), {
			sourceRoot: 'src',
			cognitionRoot: 'docs',
		});

		assert.strictEqual(
			await fs.readFile(uri('/workspace/project/docs/README.md')),
			'# Existing\n',
		);
	});

	test('creates a minimal .gitignore when missing', async () => {
		const fs = new MockFs();

		await initProject(fs, uri('/workspace/project'), {
			sourceRoot: 'src',
			cognitionRoot: 'src_cognition',
		});

		assert.strictEqual(
			await fs.readFile(uri('/workspace/project/.gitignore')),
			'*.bak\n',
		);
	});

	test('leaves an existing *.bak rule unchanged', async () => {
		const fs = new MockFs();
		await fs.writeFile(uri('/workspace/project/.gitignore'), '*.bak\n');

		await initProject(fs, uri('/workspace/project'), {
			sourceRoot: 'src',
			cognitionRoot: 'src_cognition',
		});

		assert.strictEqual(
			await fs.readFile(uri('/workspace/project/.gitignore')),
			'*.bak\n',
		);
	});
});
