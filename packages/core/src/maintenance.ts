import type { FileSystem } from './interfaces';
import { discoverCognitionEntries } from './cognitionDiscovery';
import type {
	CoggitWorkspaceRoot,
	OrphanedCognitionEntry,
	PathKeyRecord,
	StrayCognitionEntry,
} from './types';
import { keyToCognitionPath } from './identity';
import { isIgnoredSourceStructureEntry } from './sourceStructureIgnore';
import { joinUriPath, uriRelativePath } from './uri-utils';
export { detectMisplacedCognitionEntries } from './layout';

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
	const knownKeys = new Set(Object.keys(entries));
	const discovery = await discoverCognitionEntries(fs, root.cognitionRootUri, {
		sourceRootUri: root.sourceRootUri,
		shouldSkipDirectory: (name) => isIgnoredSourceStructureEntry(name, true),
	});

	return [...discovery.values()]
		.filter((entry) => !knownKeys.has(entry.registryKey))
		.map((entry) => ({
			...entry,
			cognitionPath: projectRelativePath(root, entry.cognitionUri),
		}));
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
