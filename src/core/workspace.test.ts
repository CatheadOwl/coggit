import * as assert from 'assert';

import { discoverWorkspaceRoots } from './workspace';
import type {
	ConfigProvider,
	FileStat,
	FileSystem,
	UriComponents,
	WorkspaceFolderInfo,
} from './interfaces';

suite('discoverWorkspaceRoots', () => {
	function uri(p: string): UriComponents {
		return { scheme: 'file', authority: '', path: p, query: '', fragment: '' };
	}

	class MockFs implements FileSystem {
		private readonly configs = new Map<string, string>();

		setConfig(path: string, content: string): void {
			this.configs.set(path, content);
		}

		async readFile(uri: UriComponents): Promise<string> {
			const content = this.configs.get(uri.path);
			if (content === undefined) {
				throw new Error('ENOENT');
			}
			return content;
		}
		async writeFile(_uri: UriComponents, _content: string): Promise<void> {}
		async stat(uri: UriComponents): Promise<FileStat | undefined> {
			return this.configs.has(uri.path)
				? { isDirectory: false, mtimeMs: 1000 }
				: undefined;
		}
		async readDirectory(_uri: UriComponents): Promise<Array<[string, number]>> { return []; }
		async exists(_uri: UriComponents): Promise<boolean> { return true; }
		async createDirectory(_uri: UriComponents): Promise<void> {}
		async delete(_uri: UriComponents): Promise<void> {}
	}

	class MockConfig implements ConfigProvider {
		private folders: WorkspaceFolderInfo[] = [];
		private configUris: UriComponents[] = [];

		setFolders(folders: WorkspaceFolderInfo[]): void { this.folders = folders; }
		setConfigUris(uris: UriComponents[]): void { this.configUris = uris; }

		getWorkspaceFolders(): WorkspaceFolderInfo[] { return this.folders; }
		async findFiles(_pattern: string): Promise<UriComponents[]> { return this.configUris; }
	}

	const CONFIG_YAML = 'source_root: src\ncognition_root: src_cog\n';

	test('finds workspace root via findFiles recursive scan', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace/project/.coggit/config.yaml', CONFIG_YAML);

		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([uri('/workspace/project/.coggit/config.yaml')]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].projectRootUri.path, '/workspace/project');
		assert.strictEqual(roots[0].configUri.path, '/workspace/project/.coggit/config.yaml');
	});

	test('returns empty array when findFiles returns nothing', async () => {
		const fs = new MockFs();
		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 0);
	});

	test('finds workspace root config when recursive findFiles misses hidden .coggit directory', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace/.coggit/config.yaml', CONFIG_YAML);

		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].label, 'workspace');
		assert.strictEqual(roots[0].projectRootUri.path, '/workspace');
		assert.strictEqual(roots[0].configUri.path, '/workspace/.coggit/config.yaml');
	});

	test('deduplicates workspace root config found by both direct stat and findFiles', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace/.coggit/config.yaml', CONFIG_YAML);

		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([uri('/workspace/.coggit/config.yaml')]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 1);
		assert.strictEqual(roots[0].projectRootUri.path, '/workspace');
	});

	test('matches config URI to the containing workspace folder', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace-a/project/.coggit/config.yaml', CONFIG_YAML);
		fs.setConfig('/workspace-b/other/.coggit/config.yaml', CONFIG_YAML);

		const config = new MockConfig();
		config.setFolders([
			{ uri: uri('/workspace-a'), name: 'workspace-a', index: 0 },
			{ uri: uri('/workspace-b'), name: 'workspace-b', index: 1 },
		]);
		config.setConfigUris([
			uri('/workspace-a/project/.coggit/config.yaml'),
			uri('/workspace-b/other/.coggit/config.yaml'),
		]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 2);
		assert.ok(roots.some((root) => root.label === 'project'));
		assert.ok(roots.some((root) => root.label === 'other'));
	});

	test('skips malformed config', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace/project/.coggit/config.yaml', 'irrelevant: true\n');

		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([uri('/workspace/project/.coggit/config.yaml')]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 0);
	});

	test('sorts roots by label alphabetically', async () => {
		const fs = new MockFs();
		fs.setConfig('/workspace/b-project/.coggit/config.yaml', CONFIG_YAML);
		fs.setConfig('/workspace/a-project/.coggit/config.yaml', CONFIG_YAML);

		const config = new MockConfig();
		config.setFolders([{ uri: uri('/workspace'), name: 'workspace', index: 0 }]);
		config.setConfigUris([
			uri('/workspace/b-project/.coggit/config.yaml'),
			uri('/workspace/a-project/.coggit/config.yaml'),
		]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 2);
		assert.strictEqual(roots[0].label, 'a-project');
		assert.strictEqual(roots[1].label, 'b-project');
	});

	test('survives missing workspace folders gracefully', async () => {
		const fs = new MockFs();
		const config = new MockConfig();
		config.setFolders([]);
		config.setConfigUris([]);

		const roots = await discoverWorkspaceRoots(fs, config);
		assert.strictEqual(roots.length, 0);
	});
});
