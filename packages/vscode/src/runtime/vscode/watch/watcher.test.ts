import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { createPatternWatcher, type FileChangeKind } from './watcher';

suite('watcher — external filesystem changes', () => {
	test('reports an external Node fs rename as delete and create events', async function () {
		this.timeout(10000);

		const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'coggit-watch-'));
		const sourceRoot = path.join(tempRoot, 'src');
		const oldPath = path.join(sourceRoot, 'old.ts');
		const newPath = path.join(sourceRoot, 'new.ts');
		const events: Array<{ uri: vscode.Uri; kind: FileChangeKind }> = [];

		let watcher: vscode.Disposable | undefined;
		try {
			await fs.mkdir(sourceRoot, { recursive: true });
			await fs.writeFile(oldPath, 'export const value = 1;\n', 'utf8');

			watcher = createPatternWatcher(
				new vscode.RelativePattern(vscode.Uri.file(sourceRoot), '**/*'),
				(uri, kind) => {
					events.push({ uri, kind });
				},
			);

			await sleep(250);
			await fs.rename(oldPath, newPath);

			await waitFor(() =>
				events.some((event) => event.kind === 'delete' && sameFsPath(event.uri.fsPath, oldPath)) &&
				events.some((event) => event.kind === 'create' && sameFsPath(event.uri.fsPath, newPath)),
			);
		} finally {
			watcher?.dispose();
			await fs.rm(tempRoot, { recursive: true, force: true });
		}
	});
});

function sameFsPath(a: string, b: string): boolean {
	return path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (predicate()) {
			return;
		}
		await sleep(50);
	}
	assert.fail('Timed out waiting for expected watcher events.');
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
