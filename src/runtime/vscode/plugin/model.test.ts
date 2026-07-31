import * as assert from 'node:assert';
import * as vscode from 'vscode';

import type {
	ConfigProvider,
	FileStat,
	FileSystem,
	UriComponents,
	WorkspaceFolderInfo,
} from '../../../core/interfaces';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '../../../core/types';
import type { FileChangeCallback } from '../watch/watcher';
import { CoggitModel } from './model';

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

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((settle) => {
		resolve = settle;
	});
	return { promise, resolve };
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class ModelTestFileSystem implements FileSystem {
	private readonly entries = new Map<string, { kind: 'file' | 'directory'; content?: string; mtimeMs: number }>();

	constructor() {
		this.addDirectory('/workspace');
		this.addDirectory('/workspace/.coggit');
		this.addFile('/workspace/.coggit/config.yaml', 'source_root: src\ncognition_root: cognition\n');
		this.addDirectory('/workspace/src');
		this.addFile('/workspace/src/index.ts', 'export const value = 1;\n');
		this.addDirectory('/workspace/cognition');
	}

	addDirectory(path: string, mtimeMs = 1000): void {
		this.entries.set(path, { kind: 'directory', mtimeMs });
	}

	addFile(path: string, content: string, mtimeMs = 1000): void {
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

class ModelTestConfigProvider implements ConfigProvider {
	constructor(private readonly configUris = [uri('/workspace/.coggit/config.yaml')]) {}

	getWorkspaceFolders(): WorkspaceFolderInfo[] {
		return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
	}

	async findFiles(): Promise<UriComponents[]> {
		return this.configUris;
	}
}

suite('CoggitModel refresh lifecycle', () => {
	test('publishes the main snapshot before slow issue-view collection finishes', async () => {
		const fs = new ModelTestFileSystem();
		const issueViews = deferred<CoggitTreeNode[]>();
		const model = new CoggitModel(undefined, {
			fs,
			services: {
				fs,
				config: new ModelTestConfigProvider(),
			},
			collectIssueViewState: async () => ({
				orphans: await issueViews.promise,
				misplacedEntries: [],
			}),
		});
		const firstChange = new Promise<void>((resolve) => {
			const disposable = model.onDidChange(() => {
				disposable.dispose();
				resolve();
			});
		});

		const refreshPromise = model.refresh();
		await Promise.race([
			firstChange,
			new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for main snapshot publish')), 500)),
		]);

		assert.strictEqual(model.getSnapshot().roots.length, 1);
		assert.strictEqual(model.getSnapshot().roots[0].label, 'workspace');
		assert.deepStrictEqual(model.getOrphans(), []);

		issueViews.resolve([]);
		await refreshPromise;
		model.dispose();
	});

	test('publishes Ghost Tree roots when findFiles misses workspace-root config', async () => {
		const fs = new ModelTestFileSystem();
		const model = new CoggitModel(undefined, {
			fs,
			services: {
				fs,
				config: new ModelTestConfigProvider([]),
			},
			collectIssueViewState: async () => ({
				orphans: [],
				misplacedEntries: [],
			}),
		});

		await model.refresh();

		assert.strictEqual(model.getSnapshot().roots.length, 1);
		assert.strictEqual(model.getSnapshot().roots[0].label, 'workspace');
		assert.strictEqual(model.getSnapshot().roots[0].root.configUri.path, '/workspace/.coggit/config.yaml');
		model.dispose();
	});

	test('debounces source watcher create/delete storms into one full refresh', async () => {
		const fs = new ModelTestFileSystem();
		let issueViewCollectionCount = 0;
		const watchers: Array<{
			readonly pattern: vscode.GlobPattern;
			readonly onChange: FileChangeCallback;
			disposed: boolean;
		}> = [];
		const model = new CoggitModel(undefined, {
			fs,
			services: {
				fs,
				config: new ModelTestConfigProvider(),
			},
			collectIssueViewState: async () => {
				issueViewCollectionCount++;
				return {
					orphans: [],
					misplacedEntries: [],
				};
			},
			createPatternWatcher: (pattern, onChange) => {
				const watcher = { pattern, onChange, disposed: false };
				watchers.push(watcher);
				return {
					dispose: () => {
						watcher.disposed = true;
					},
				};
			},
			refreshDebounceMs: 10,
		});
		let changeCount = 0;
		const disposable = model.onDidChange(() => {
			changeCount++;
		});

		await model.refresh();
		const baselineChangeCount = changeCount;
		const baselineIssueViewCollectionCount = issueViewCollectionCount;
		const sourceWatcher = watchers.find((watcher) =>
			typeof watcher.pattern !== 'string' &&
			watcher.pattern.baseUri.path === '/workspace/src' &&
			watcher.pattern.pattern === '**/*',
		);
		assert.ok(sourceWatcher, 'expected source root watcher to be installed');

		for (let index = 0; index < 20; index++) {
			const kind = index % 2 === 0 ? 'create' : 'delete';
			sourceWatcher.onChange(vscode.Uri.file(`/workspace/src/generated-${index}.ts`), kind);
		}

		await Promise.race([
			(async () => {
				while (changeCount === baselineChangeCount) {
					await delay(5);
				}
			})(),
			delay(500).then(() => {
				throw new Error('Timed out waiting for debounced watcher refresh');
			}),
		]);
		await delay(50);

		assert.strictEqual(issueViewCollectionCount - baselineIssueViewCollectionCount, 1);
		// A single full refresh currently publishes once for the main tree and
		// once for the derived maintenance issue views.
		assert.strictEqual(changeCount - baselineChangeCount, 2);
		disposable.dispose();
		model.dispose();
	});
});
