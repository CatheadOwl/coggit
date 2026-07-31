import type { FileSystem } from './interfaces';
import type {
	CoggitWorkspaceRoot,
	OrphanedCognitionEntry,
	PathKeyRecord,
	StrayCognitionEntry,
} from './types';
import { cognitionPathToKey, isTrackedCognitionFile, keyToCognitionPath } from './identity';
import { inferSourceUriCandidatesFromCognitionUri } from './mapping';
import { isIgnoredSourceStructureEntry } from './sourceStructureIgnore';
import { joinUriPath, uriRelativePath } from './uri-utils';
export { detectMisplacedCognitionEntries } from './layout';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export async function detectOrphanedCognitionEntries(
	root: CoggitWorkspaceRoot,
	fs: FileSystem,
	entries: Record<string, PathKeyRecord>,
): Promise<OrphanedCognitionEntry[]> {
	const orphaned: OrphanedCognitionEntry[] = [];

	for (const [registryKey, entry] of Object.entries(entries)) {
		if (entry.sourcePath === null || hasIgnoredSourceStructureSegment(entry.sourcePath)) {
			continue;
		}

		const sourceUri = joinRelativePath(root.projectRootUri, entry.sourcePath);
		if (await fs.stat(sourceUri)) {
			continue;
		}

		const cognitionPath = keyToCognitionPath(registryKey, entry.type);
		const cognitionUri = joinRelativePath(root.cognitionRootUri, cognitionPath);
		if (!(await fs.stat(cognitionUri))) {
			continue;
		}

		orphaned.push({
			registryKey,
			type: entry.type,
			sourcePath: entry.sourcePath,
			sourceUri,
			cognitionPath: projectRelativePath(root, cognitionUri),
			cognitionUri,
		});
	}

	return orphaned;
}

export async function detectStrayCognitionEntries(
	root: CoggitWorkspaceRoot,
	fs: FileSystem,
	entries: Record<string, PathKeyRecord>,
): Promise<StrayCognitionEntry[]> {
	const stray: StrayCognitionEntry[] = [];
	const knownKeys = new Set(Object.keys(entries));

	try {
		await walkCognitionDir(root.cognitionRootUri, root, fs, knownKeys, stray);
	} catch {
		// The cognition root may not exist yet.
	}

	return stray;
}

async function walkCognitionDir(
	dirUri: Parameters<typeof joinUriPath>[0],
	root: CoggitWorkspaceRoot,
	fs: FileSystem,
	knownKeys: ReadonlySet<string>,
	stray: StrayCognitionEntry[],
): Promise<void> {
	const entries = await fs.readDirectory(dirUri).catch(() => []);

	for (const [name, type] of entries) {
		const childUri = joinUriPath(dirUri, name);
		const isDirectory = (type & FILE_TYPE_DIRECTORY) !== 0;

		if (isIgnoredSourceStructureEntry(name, isDirectory)) {
			continue;
		}

		if (isDirectory) {
			await walkCognitionDir(childUri, root, fs, knownKeys, stray);
			continue;
		}

		if ((type & FILE_TYPE_FILE) === 0 || !name.endsWith('.md')) {
			continue;
		}

		const cognitionRootPath = uriRelativePath(root.cognitionRootUri, childUri);
		if (cognitionRootPath === undefined || !isTrackedCognitionFile(cognitionRootPath)) {
			continue;
		}

		const registryKey = cognitionPathToKey(cognitionRootPath);
		if (knownKeys.has(registryKey)) {
			continue;
		}

		stray.push({
			registryKey,
			type: cognitionRootPath.endsWith('README.md') ? 'folder' : 'leaf',
			cognitionPath: projectRelativePath(root, childUri),
			cognitionUri: childUri,
			sourceCandidateUris: inferSourceUriCandidatesFromCognitionUri(
				childUri,
				root.sourceRootUri,
				root.cognitionRootUri,
			),
		});
	}
}

function hasIgnoredSourceStructureSegment(sourcePath: string): boolean {
	const segments = sourcePath.replace(/\\/g, '/').split('/').filter(Boolean);
	return segments.some((segment, index) =>
		isIgnoredSourceStructureEntry(segment, index < segments.length - 1),
	);
}

function projectRelativePath(root: CoggitWorkspaceRoot, uri: Parameters<typeof uriRelativePath>[1]): string {
	return uriRelativePath(root.projectRootUri, uri) ?? uri.path;
}

function joinRelativePath(rootUri: Parameters<typeof joinUriPath>[0], relativePath: string) {
	const segments = relativePath.replace(/\\/g, '/').split('/').filter((segment) =>
		segment.length > 0 && segment !== '.',
	);
	return segments.length === 0 ? rootUri : joinUriPath(rootUri, ...segments);
}
