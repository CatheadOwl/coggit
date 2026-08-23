import * as vscode from 'vscode';

import type { WatchFileChangeKind } from '@coggit/core/internal';

export type FileChangeKind = WatchFileChangeKind;

export type FileChangeCallback = (uri: vscode.Uri, kind: FileChangeKind) => void;

/**
 * Create a FileSystemWatcher subscribed to change/create/delete events.
 */
export function createPatternWatcher(
	pattern: vscode.GlobPattern,
	onChange: FileChangeCallback,
): vscode.Disposable {
	const watcher = vscode.workspace.createFileSystemWatcher(pattern);
	const subscriptions: vscode.Disposable[] = [
		watcher,
		watcher.onDidChange((uri) => onChange(uri, 'change')),
		watcher.onDidCreate((uri) => onChange(uri, 'create')),
		watcher.onDidDelete((uri) => onChange(uri, 'delete')),
	];
	return vscode.Disposable.from(...subscriptions);
}
