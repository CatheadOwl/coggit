import type { RegistryProvider, RegistryFile } from '../types';

/**
 * In-memory registry provider for testing.
 *
 * Stores data as a deep-cloned JSON object so each load/save round-trip
 * produces independent copies (no shared references).
 *
 * This is a pure core test double (no host runtime dependency), so it lives in
 * the core package next to the `RegistryProvider` port it implements rather than
 * in a runtime adapter.
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
		this.data = { schemaVersion: 0, entries: {} as any };
	}
}
