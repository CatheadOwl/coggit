import * as assert from 'assert';
import * as path from 'node:path';

import type { FileStat, FileSystem, UriComponents } from '../core/interfaces';
import { pathToUriComponents } from '../runtime/node/uri';
import { runInit } from './init';
import { UserFacingError } from './status';

const TARGET = path.resolve('/coggit-init-project');

suite('cli init', () => {
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

	function configUri(): UriComponents {
		return pathToUriComponents(path.join(TARGET, '.coggit', 'config.yaml'));
	}

	async function readConfig(fs: FileSystem): Promise<string> {
		return fs.readFile(configUri());
	}

	async function rejectsUserFacingError(promise: Promise<unknown>, message: string): Promise<void> {
		await assert.rejects(promise, (error: unknown) =>
			error instanceof UserFacingError && error.message === message,
		);
	}

	test('defaults to src/src_cognition when no options are given', async () => {
		const fs = new MockFs();

		const output = await runInit(fs, TARGET);

		assert.strictEqual(output, `CogGit initialised at ${path.resolve(TARGET)}.`);
		const config = await readConfig(fs);
		assert.match(config, /source_root: "src"/);
		assert.match(config, /cognition_root: "src_cognition"/);

		const readme = await fs.readFile(pathToUriComponents(path.join(TARGET, 'src_cognition', 'README.md')));
		assert.match(readme, /^# CogGit Cognition/);

		assert.strictEqual(
			await fs.readFile(pathToUriComponents(path.join(TARGET, '.gitignore'))),
			'*.bak\n',
		);
	});

	test('derives cognition root from source root when omitted', async () => {
		const fs = new MockFs();

		await runInit(fs, TARGET, { sourceRoot: 'foo' });

		const config = await readConfig(fs);
		assert.match(config, /source_root: "foo"/);
		assert.match(config, /cognition_root: "foo_cognition"/);
	});

	test('uses explicit source and cognition roots verbatim', async () => {
		const fs = new MockFs();

		await runInit(fs, TARGET, { sourceRoot: 'lib', cognitionRoot: 'docs' });

		const config = await readConfig(fs);
		assert.match(config, /source_root: "lib"/);
		assert.match(config, /cognition_root: "docs"/);
	});

	test('trims root options before use', async () => {
		const fs = new MockFs();

		await runInit(fs, TARGET, { sourceRoot: '  foo  ' });

		const config = await readConfig(fs);
		assert.match(config, /source_root: "foo"/);
		assert.match(config, /cognition_root: "foo_cognition"/);
	});

	test('rejects an empty source root', async () => {
		const fs = new MockFs();

		await rejectsUserFacingError(
			runInit(fs, TARGET, { sourceRoot: '   ' }),
			'Source root cannot be empty.',
		);
	});

	test('rejects an empty cognition root', async () => {
		const fs = new MockFs();

		await rejectsUserFacingError(
			runInit(fs, TARGET, { cognitionRoot: '   ' }),
			'Cognition root cannot be empty.',
		);
	});

	test('throws when .coggit/config.yaml already exists', async () => {
		const fs = new MockFs();
		await fs.writeFile(configUri(), '# existing\n');

		await rejectsUserFacingError(
			runInit(fs, TARGET),
			'CogGit project already initialised at this root. Remove .coggit/config.yaml to re-initialise.',
		);
	});
});
