import * as vscode from 'vscode';
import type { RegistryProvider, RegistryFile } from '../../../core/types';
import type { UriComponents } from '../../../core/interfaces';
import type { CoggitLogger } from '../../../core/logger';
import { warnLog } from '../../../core/logger';

/**
 * VSCode filesystem adapter for .coggit/registry.json persistence.
 *
 * Implements atomic write via .tmp → rename, and .bak recovery on parse failure.
 */
export class VscodeRegistryProvider implements RegistryProvider {
	private readonly coggitDir: vscode.Uri;
	private readonly registryUri: vscode.Uri;
	private readonly registryTmpUri: vscode.Uri;
	private readonly registryBakUri: vscode.Uri;

	constructor(
		rootUri: UriComponents,
		private readonly logger?: CoggitLogger,
	) {
		const root = vscode.Uri.from(rootUri);
		this.coggitDir = vscode.Uri.joinPath(root, '.coggit');
		this.registryUri = vscode.Uri.joinPath(this.coggitDir, 'registry.json');
		this.registryTmpUri = vscode.Uri.joinPath(this.coggitDir, 'registry.json.tmp');
		this.registryBakUri = vscode.Uri.joinPath(this.coggitDir, 'registry.json.bak');
	}

	// ─── Load ────────────────────────────────────────────────────────────────────

	async load(): Promise<RegistryFile | null> {
		let raw: string;
		try {
			const bytes = await vscode.workspace.fs.readFile(this.registryUri);
			raw = new TextDecoder().decode(bytes);
		} catch {
			// File not found or unreadable → return null (clean rebuild)
			return null;
		}

		try {
			return JSON.parse(raw) as RegistryFile;
		} catch {
			// JSON parse failure → attempt .bak recovery
			return this.restoreFromBackup();
		}
	}

	/**
	 * Attempt to recover from .bak on parse failure.
	 * Restores .bak content to primary file and returns parsed data.
	 * Returns null if .bak is also missing or corrupt.
	 */
	private async restoreFromBackup(): Promise<RegistryFile | null> {
		try {
			const bakBytes = await vscode.workspace.fs.readFile(this.registryBakUri);
			const bakText = new TextDecoder().decode(bakBytes);
			const bakData = JSON.parse(bakText) as RegistryFile;

			warnLog(this.logger, 'registry.io', 'registry.json corrupted, restored from backup');

			// Restore .bak content to primary file
			await vscode.workspace.fs.writeFile(
				this.registryUri,
				new TextEncoder().encode(bakText),
			);

			return bakData;
		} catch {
			// .bak also corrupt or missing → clean rebuild
			return null;
		}
	}

	// ─── Save (atomic write) ─────────────────────────────────────────────────────

	async save(file: RegistryFile): Promise<void> {
		const serialized = JSON.stringify(file, null, 2);
		const encoded = new TextEncoder().encode(serialized);

		// Ensure .coggit directory exists before writing
		try {
			await vscode.workspace.fs.createDirectory(this.coggitDir);
		} catch {
			// Directory may already exist — proceed
		}

		// Atomic write: write .tmp then rename over target
		await vscode.workspace.fs.writeFile(this.registryTmpUri, encoded);
		await vscode.workspace.fs.rename(this.registryTmpUri, this.registryUri, {
			overwrite: true,
		});

		// Write backup copy (best-effort — not fatal if it fails)
		try {
			await vscode.workspace.fs.writeFile(this.registryBakUri, encoded);
		} catch {
			warnLog(this.logger, 'registry.io', 'Failed to write registry backup');
		}
	}
}

/**
 * In-memory registry provider for testing.
 *
 * Stores data as a deep-cloned JSON object so each load/save round-trip
 * produces independent copies (no shared references).
 */
export class InMemoryRegistryProvider implements RegistryProvider {
	private data: RegistryFile | null = null;

	async load(): Promise<RegistryFile | null> {
		return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
	}

	async save(file: RegistryFile): Promise<void> {
		this.data = JSON.parse(JSON.stringify(file));
	}

	/** Test helper: simulate corrupt data to exercise recovery paths. */
	corrupt(): void {
		this.data = { schemaVersion: 0, updatedAt: '', entries: {} as any };
	}
}
