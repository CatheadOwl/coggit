import * as assert from 'node:assert';

import type { ConfigProvider, FileStat, FileSystem, TrackedEntriesIndex, TrackedShapeDomain, UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot, RegistryFile } from './types';
import { openCoggitProject, RuntimeAcceptanceEvidence } from './project';
import { resolveOperation, statusOperation } from './operations';

// Folder skeleton freshness observes the git-tracked shape: a folder's
// directory-entry source fact fingerprints only tracked children when a
// `TrackedEntriesIndex` answers, so scratch trees that git does not track
// (untracked and not gitignored) must NOT flip skeleton pairs stale, and a
// fresh clone — which lacks untracked entries — reproduces the same shape.
// Without an index (non-git hosts), the fallback counts every on-disk entry,
// preserving the pre-tracked-shape behavior those hosts already shipped with.
// These tests assert through the status operation surface — the face
// `coggit status` reports; `coggit snapshot` rides the same snapshot build.

const ROOT_SKELETON = [
	'# Workspace skeleton',
	'',
	'The workspace root groups the codebase delivery subtree.',
	'Delivery code lives under codebase with its own adapters.',
	'This prose is long enough to count as maintained cognition.',
].join('\n');

const CODEBASE_SKELETON_BASELINE = [
	'# Codebase skeleton',
	'',
	'The codebase folder carries the delivered source tree.',
	'Adapters nest below with their own leaf coverage.',
	'This prose is long enough to count as maintained cognition.',
].join('\n');

const CODEBASE_SKELETON_WITH_SCRIPTS = [
	'# Codebase skeleton',
	'',
	'The codebase folder carries the delivered source tree.',
	'Adapters nest below; scripts collects local tooling.',
	'This prose is long enough to count as maintained cognition.',
].join('\n');

interface MockFileEntry {
	isDirectory: boolean;
	content: string;
	mtimeMs: number;
}

class MockFileSystem implements FileSystem {
	private entries = new Map<string, MockFileEntry>();

	addDirectory(path: string, mtimeMs = 1000): void {
		this.entries.set(path, { isDirectory: true, content: '', mtimeMs });
	}

	addFile(path: string, content: string, mtimeMs = 1000): void {
		this.entries.set(path, { isDirectory: false, content, mtimeMs });
		const parts = path.split('/').filter(Boolean);
		for (let i = 1; i < parts.length; i++) {
			const dirPath = '/' + parts.slice(0, i).join('/');
			if (!this.entries.has(dirPath)) {
				this.addDirectory(dirPath, mtimeMs);
			}
		}
	}

	deleteTree(path: string): void {
		for (const key of [...this.entries.keys()]) {
			if (key === path || key.startsWith(`${path}/`)) {
				this.entries.delete(key);
			}
		}
	}

	mkdir(path: string, mtimeMs = 1000): void {
		this.addDirectory(path, mtimeMs);
	}

	async readFile(uri: UriComponents): Promise<string> {
		const entry = this.entries.get(uri.path);
		if (!entry || entry.isDirectory) {
			throw new Error('ENOENT');
		}
		return entry.content;
	}

	async writeFile(uri: UriComponents, content: string): Promise<void> {
		this.addFile(uri.path, content);
	}

	async stat(uri: UriComponents): Promise<FileStat | undefined> {
		const entry = this.entries.get(uri.path);
		return entry
			? { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs }
			: undefined;
	}

	async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
		const dirPath = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
		const children: Array<[string, number]> = [];
		for (const [path, entry] of this.entries) {
			if (path === uri.path || !path.startsWith(dirPath)) {
				continue;
			}
			const rest = path.slice(dirPath.length);
			if (rest.length > 0 && !rest.includes('/')) {
				children.push([rest, entry.isDirectory ? 2 : 1]);
			}
		}
		return children.sort(([left], [right]) => left.localeCompare(right));
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

class MockConfigProvider implements ConfigProvider {
	getWorkspaceFolders() {
		return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
	}

	async findFiles(): Promise<UriComponents[]> {
		return [];
	}
}

class MemoryRegistryProvider {
	private data: RegistryFile | null = null;

	async load(): Promise<RegistryFile | null> {
		return this.data ? JSON.parse(JSON.stringify(this.data)) : null;
	}

	async save(file: RegistryFile): Promise<void> {
		this.data = JSON.parse(JSON.stringify(file));
	}
}

/** Scriptable index: git answers per directory path; unlisted directories yield non-git (include-all). */
class StubTrackedEntries implements TrackedEntriesIndex {
	private readonly unavailableDirs: Set<string>;

	constructor(private readonly namesByDir: Map<string, Set<string>>) {
		this.unavailableDirs = new Set();
	}

	markUnavailable(path: string): void {
		this.unavailableDirs.add(path);
	}

	markAvailable(path: string): void {
		this.unavailableDirs.delete(path);
	}

	async trackedChildNames(directoryUri: UriComponents): Promise<TrackedShapeDomain> {
		if (this.unavailableDirs.has(directoryUri.path)) {
			return { kind: 'unavailable' };
		}
		const names = this.namesByDir.get(directoryUri.path);
		return names ? { kind: 'git', names } : { kind: 'non-git' };
	}
}

function uri(path: string): UriComponents {
	return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

function makeRoot(): CoggitWorkspaceRoot {
	return {
		id: 'root',
		label: 'root',
		workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
		configUri: uri('/workspace/.coggit/config.yaml'),
		projectRootUri: uri('/workspace'),
		sourceRootUri: uri('/workspace/src'),
		cognitionRootUri: uri('/workspace/cognition'),
	};
}

async function makeProject(fs: MockFileSystem, trackedEntries?: TrackedEntriesIndex) {
	// One provider instance per project: reconcile re-loads through the
	// factory, so a fresh instance per call would silently wipe accepted
	// state on every reconcile.
	const provider = new MemoryRegistryProvider();
	return openCoggitProject(
		{
			fs,
			config: new MockConfigProvider(),
			registry: { create: () => provider },
			trackedEntries,
		},
		makeRoot(),
	);
}

/** Baseline workspace mirroring the reported layout: codebase/ with an accepted skeleton. */
function mkBaselineFs(): MockFileSystem {
	const fs = new MockFileSystem();
	fs.addFile('/workspace/src/codebase/README.md', '# codebase\n\nDelivered source.\n');
	fs.addFile('/workspace/cognition/README.md', ROOT_SKELETON, 2000);
	fs.addFile('/workspace/cognition/codebase/README.md', CODEBASE_SKELETON_BASELINE, 2000);
	return fs;
}

const IDENTITY_A: `sha256:v1:${string}` = `sha256:v1:${'a'.repeat(56)}`;
const IDENTITY_B: `sha256:v1:${string}` = `sha256:v1:${'b'.repeat(56)}`;

function issueCodes(result: { issues: ReadonlyArray<{ code: string } | null> }): string[] {
	return result.issues.filter((issue): issue is { code: string } => issue !== null).map((issue) => issue.code);
}

suite('untracked scratch directory vs skeleton status (status surface)', () => {
	test('with a tracked-shape index, scratch toggling never stales skeletons', async () => {
		const fs = mkBaselineFs();
		// A fully committed repo: the root tracks codebase/, codebase tracks its README.
		const namesByDir = new Map<string, Set<string>>([
			['/workspace/src', new Set(['codebase'])],
			['/workspace/src/codebase', new Set(['README.md'])],
		]);
		const project = await makeProject(fs, new StubTrackedEntries(namesByDir));

		assert.strictEqual((await statusOperation([project], '.')).status, 'fresh');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');

		// Scratch appears: untracked and not gitignored. git cannot even track
		// empty dirs, so the git-visible tree is unchanged — and now the
		// skeleton pair stays fresh instead of flapping stale on every toggle.
		fs.mkdir('/workspace/src/codebase/scripts');
		fs.addFile('/workspace/src/codebase/scripts/scratch.js', '// scratch\n');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
		assert.strictEqual((await statusOperation([project], '.')).status, 'fresh');

		// Cleanup (the scratch lifecycle's other half): still fresh.
		fs.deleteTree('/workspace/src/codebase/scripts');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
		assert.strictEqual((await statusOperation([project], '.')).status, 'fresh');
	});

	test('tracked entry add/remove still stales skeletons and resolves (original contract)', async () => {
		const fs = mkBaselineFs();
		const namesByDir = new Map<string, Set<string>>([
			['/workspace/src', new Set(['codebase'])],
			['/workspace/src/codebase', new Set(['README.md'])],
		]);
		const project = await makeProject(fs, new StubTrackedEntries(namesByDir));
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');

		// `git add scripts`: the entry joins the tracked shape → structural
		// signal fires exactly as the spec requires for real structure.
		fs.mkdir('/workspace/src/codebase/scripts');
		namesByDir.set('/workspace/src/codebase', new Set(['README.md', 'scripts']));
		const stale = await statusOperation([project], 'codebase');
		assert.strictEqual(stale.ownStatus, 'stale');
		assert.ok(issueCodes(stale).includes('folder-structure-outdated'));
		assert.ok(stale.suggestedActions.some((action) => action.operation === 'resolve'));
		// Root pair untouched (its own tracked shape did not change); the root
		// goes stale through descendant aggregation.
		const root = await statusOperation([project], '.');
		assert.strictEqual(root.ownStatus, 'fresh');
		assert.strictEqual(root.status, 'stale');

		// The reported loop still heals: sync the skeleton, then resolve.
		fs.addFile('/workspace/cognition/codebase/README.md', CODEBASE_SKELETON_WITH_SCRIPTS, 4000);
		const review = await resolveOperation([project], 'codebase');
		assert.strictEqual(review.success, true);
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
		assert.strictEqual((await statusOperation([project], '.')).status, 'fresh');

		// `git rm --cached scripts`: leaving the tracked shape stales again.
		namesByDir.set('/workspace/src/codebase', new Set(['README.md']));
		assert.strictEqual((await statusOperation([project], 'codebase')).ownStatus, 'stale');
		await resolveOperation([project], 'codebase');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
	});

	test('without an index (non-git fallback), presence toggling repeats stale as before', async () => {
		const fs = mkBaselineFs();
		const project = await makeProject(fs);

		// Baseline: root and codebase skeletons bootstrapped fresh.
		let root = await statusOperation([project], '.');
		assert.strictEqual(root.status, 'fresh');
		let codebase = await statusOperation([project], 'codebase');
		assert.strictEqual(codebase.status, 'fresh');

		// An empty untracked dir appears. The fallback counts every on-disk
		// entry, so the skeletons go stale — the pre-tracked-shape behavior.
		fs.mkdir('/workspace/src/codebase/scripts');
		codebase = await statusOperation([project], 'codebase');
		assert.strictEqual(codebase.ownStatus, 'stale');
		assert.ok(issueCodes(codebase).includes('folder-structure-outdated'));
		root = await statusOperation([project], '.');
		assert.strictEqual(root.ownStatus, 'fresh');
		assert.strictEqual(root.status, 'stale');

		// Sync + resolve heals once.
		fs.addFile('/workspace/cognition/codebase/README.md', CODEBASE_SKELETON_WITH_SCRIPTS, 4000);
		await resolveOperation([project], 'codebase');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');

		// Scratch cleanup: the git-visible tree is byte-identical to the
		// baseline, yet the fallback stales again — the repeated trigger the
		// tracked-shape index exists to remove on git-backed hosts.
		fs.deleteTree('/workspace/src/codebase/scripts');
		assert.strictEqual((await statusOperation([project], 'codebase')).ownStatus, 'stale');
		assert.strictEqual((await statusOperation([project], '.')).status, 'stale');
	});

	test('fallback mode: top-level untracked dir stales the root skeleton own pair', async () => {
		const fs = mkBaselineFs();
		const project = await makeProject(fs);
		assert.strictEqual((await statusOperation([project], '.')).ownStatus, 'fresh');

		fs.mkdir('/workspace/src/scratch');
		const root = await statusOperation([project], '.');
		assert.strictEqual(root.ownStatus, 'stale');
		assert.ok(issueCodes(root).includes('folder-structure-outdated'));
	});

	test('the same churn under a gitignored path keeps status fresh', async () => {
		const fs = mkBaselineFs();
		fs.addFile('/workspace/src/.gitignore', 'scripts/\n');
		const project = await makeProject(fs);

		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
		fs.mkdir('/workspace/src/codebase/scripts');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
		assert.strictEqual((await statusOperation([project], '.')).status, 'fresh');
		fs.deleteTree('/workspace/src/codebase/scripts');
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
	});

	test('folder observations never establish ordering; explicit resolve heals', async () => {
		const fs = mkBaselineFs();
		// scripts is tracked and present on disk from the start.
		fs.mkdir('/workspace/src/codebase/scripts');
		const namesByDir = new Map<string, Set<string>>([
			['/workspace/src', new Set(['codebase'])],
			['/workspace/src/codebase', new Set(['README.md', 'scripts'])],
		]);
		const project = await makeProject(fs, new StubTrackedEntries(namesByDir));
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');

		// A tracked transition records a directory observation (consumed by
		// rename relocation and registry bookkeeping), but folder events can
		// never prove that the re-read shape preceded a cognition edit —
		// ordered auto-acceptance is leaf-only, so this observation does not
		// enable any auto-acceptance for the folder pair.
		fs.mkdir('/workspace/src/codebase/dir2');
		fs.addFile('/workspace/src/codebase/dir2/keep.ts', 'export const keep = 1;\n');
		namesByDir.set('/workspace/src/codebase', new Set(['README.md', 'scripts', 'dir2']));
		assert.strictEqual(await project.recordDirectoryEntryChange(
			uri('/workspace/src/codebase/dir2'), 1,
		), true);

		// The tracked shape changed: stale, and a synced cognition does NOT
		// auto-accept — the pair heals through explicit resolve.
		fs.addFile('/workspace/cognition/codebase/README.md', CODEBASE_SKELETON_WITH_SCRIPTS, 4000);
		await project.recordCognitionChange(
			uri('/workspace/cognition/codebase/README.md'), 2,
		);
		const conservative = await statusOperation([project], 'codebase');
		assert.strictEqual(conservative.status, 'stale');

		const review = await resolveOperation([project], 'codebase');
		assert.strictEqual(review.success, true);
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
	});

	test('unavailable tracked-shape index holds acceptance writes for folder pairs', async () => {
		const fs = mkBaselineFs();
		const namesByDir = new Map<string, Set<string>>([
			['/workspace/src', new Set(['codebase'])],
			['/workspace/src/codebase', new Set(['README.md'])],
		]);
		const stub = new StubTrackedEntries(namesByDir);
		const project = await makeProject(fs, stub);
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');

		// The index goes blind (transient git failure) and the tracked shape
		// changes: display falls back to include-all and shows stale, but the
		// resolve must REFUSE to persist the wrong-domain fingerprint.
		stub.markUnavailable('/workspace/src/codebase');
		// Display during unavailability rides the pre-v5 mtime heuristic (no
		// domain to compare against; degraded marking is a registered follow-up).
		// The guarantee under test: the resolve must REFUSE to persist the
		// include-all fingerprint while the index is blind.
		fs.mkdir('/workspace/src/codebase/scripts', 5000);
		const blindResolve = await resolveOperation([project], 'codebase');
		assert.strictEqual(blindResolve.success, false);
		assert.strictEqual(blindResolve.error?.code, 'tracked-shape-unavailable');

		// Index recovers: the old accepted pair is intact, normal loop applies.
		stub.markAvailable('/workspace/src/codebase');
		namesByDir.set('/workspace/src/codebase', new Set(['README.md', 'scripts']));
		fs.addFile('/workspace/cognition/codebase/README.md', CODEBASE_SKELETON_WITH_SCRIPTS, 4000);
		const review = await resolveOperation([project], 'codebase');
		assert.strictEqual(review.success, true);
		assert.strictEqual((await statusOperation([project], 'codebase')).status, 'fresh');
	});

	test('bootstrap does not persist a fingerprint while the index is unavailable', async () => {
		const fs = mkBaselineFs();
		fs.mkdir('/workspace/src/codebase/scripts', 5000);
		const namesByDir = new Map<string, Set<string>>();
		const stub = new StubTrackedEntries(namesByDir);
		stub.markUnavailable('/workspace/src/codebase');
		const project = await makeProject(fs, stub);

		// Display works through the fallback (degraded info issue attached);
		// no acceptance may be written from the include-all fingerprint.
		const degraded = await statusOperation([project], 'codebase');
		assert.ok(issueCodes(degraded).includes('tracked-shape-unverified'));

		// Recovery: the true tracked shape answers, and the pair bootstraps
		// from the CORRECT domain — a poisoned include-all baseline would
		// keep the pair stale here instead of reading fresh.
		namesByDir.set('/workspace/src/codebase', new Set(['README.md']));
		stub.markAvailable('/workspace/src/codebase');
		const healed = await statusOperation([project], 'codebase');
		assert.strictEqual(healed.status, 'fresh');
		assert.ok(!issueCodes(healed).includes('tracked-shape-unverified'));
	});

	suite('runtime acceptance evidence record transitions (leaf ordered path)', () => {
		test('first observation records, later generations update, same identity keeps the record identity', () => {
			const evidence = new RuntimeAcceptanceEvidence();
			evidence.beginSource('k', 1);
			assert.strictEqual(evidence.completeSource('k', 1, IDENTITY_A), true);
			assert.strictEqual(evidence.lastSourceIdentity('k'), IDENTITY_A);

			// Non-transition: the same identity re-read keeps the recorded
			// identity (the generation counter may move; the recorded identity
			// is what ordering evidence reads).
			evidence.beginSource('k', 2);
			assert.strictEqual(evidence.completeSource('k', 2, IDENTITY_A), true);
			assert.strictEqual(evidence.lastSourceIdentity('k'), IDENTITY_A);

			evidence.beginSource('k', 3);
			assert.strictEqual(evidence.completeSource('k', 3, IDENTITY_B), true);
			assert.strictEqual(evidence.lastSourceIdentity('k'), IDENTITY_B);
		});

		test('a source observation later than recorded cognition is refused', () => {
			const evidence = new RuntimeAcceptanceEvidence();
			evidence.recordCognition('k', 3);
			evidence.beginSource('k', 2);
			assert.strictEqual(evidence.completeSource('k', 2, IDENTITY_B), false);
			assert.strictEqual(evidence.lastSourceIdentity('k'), null);
		});

		test('consumption watermark guards leaf keys; folder keys are exempt', () => {
			const evidence = new RuntimeAcceptanceEvidence();
			// Arrival generations advance monotonically, like the watcher counter.
			evidence.normalizeGeneration(2);
			// Leaf key: an observation below the consumption point is refused
			// (it cannot prove ordering against the consuming cognition).
			evidence.beginSource('leaf.ts', 2);
			assert.strictEqual(evidence.completeSource('leaf.ts', 2, IDENTITY_A), true);
			evidence.clear('leaf.ts');
			assert.strictEqual(evidence.consumedGenerationFor('leaf.ts'), 2);
			evidence.beginSource('leaf.ts', 1);
			assert.strictEqual(evidence.completeSource('leaf.ts', 1, IDENTITY_B), false);

			// Folder key: exempt — rename relocation and refresh routing keep
			// their fallback even after an acceptance consumed the record.
			// Probe shape mirrors the late-delivery repro: the folder
			// observation completes AFTER the consuming acceptance and still
			// records (begin refused would break the rename refresh fallback).
			evidence.clear('codebase/');
			evidence.beginSource('codebase/', 1);
			assert.strictEqual(evidence.completeSource('codebase/', 1, IDENTITY_B), true);
			assert.strictEqual(evidence.lastSourceIdentity('codebase/'), IDENTITY_B);
		});
	});
});
