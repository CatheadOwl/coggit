import type { FileSystem, UriComponents } from './interfaces';
import { cognitionPathToKey, isTrackedCognitionFile } from './identity';
import { inferSourceUriCandidatesFromCognitionUri } from './mapping';
import type { CognitionDiscoveryEntry, SourceCandidateState } from './types';
import { joinUriPath, uriRelativePath } from './uri-utils';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export interface CognitionDiscoveryOptions {
	sourceRootUri?: UriComponents;
	checkSourceCandidates?: boolean;
	shouldSkipDirectory?: (name: string) => boolean;
}

export type CognitionDiscovery = Map<string, CognitionDiscoveryEntry>;

export async function discoverCognitionEntries(
	fs: FileSystem,
	cognitionRootUri: UriComponents,
	options: CognitionDiscoveryOptions = {},
): Promise<CognitionDiscovery> {
	const result: CognitionDiscovery = new Map();
	await walkCognitionDir(fs, cognitionRootUri, cognitionRootUri, result, options);
	return result;
}

async function walkCognitionDir(
	fs: FileSystem,
	rootUri: UriComponents,
	dirUri: UriComponents,
	result: CognitionDiscovery,
	options: CognitionDiscoveryOptions,
): Promise<void> {
	const entries = await fs.readDirectory(dirUri).catch(() => []);

	for (const [name, type] of entries) {
		const childUri = joinUriPath(dirUri, name);
		const isDirectory = (type & FILE_TYPE_DIRECTORY) !== 0;

		if (isDirectory) {
			if (options.shouldSkipDirectory?.(name) === true) {
				continue;
			}
			await walkCognitionDir(fs, rootUri, childUri, result, options);
			continue;
		}

		if ((type & FILE_TYPE_FILE) === 0 || !name.endsWith('.md')) {
			continue;
		}

		const cognitionPath = uriRelativePath(rootUri, childUri);
		if (cognitionPath === undefined || !isTrackedCognitionFile(cognitionPath)) {
			continue;
		}

		const sourceCandidateUris = options.sourceRootUri
			? inferSourceUriCandidatesFromCognitionUri(childUri, options.sourceRootUri, rootUri)
			: [];

		const registryKey = cognitionPathToKey(cognitionPath);
		const cognitionType = inferTypeFromCognitionPath(cognitionPath);
		result.set(registryKey, {
			registryKey,
			type: cognitionType,
			cognitionPath,
			cognitionUri: childUri,
			sourceCandidateUris,
			// Folder cognition candidates are directories, whose existence is
			// almost always true and carries no diagnostic signal.
			sourceCandidateState: options.checkSourceCandidates && cognitionType === 'leaf'
				? await checkSourceCandidateState(fs, childUri, options.sourceRootUri, rootUri)
				: 'unchecked',
		});
	}
}

function inferTypeFromCognitionPath(cognitionPath: string): 'leaf' | 'folder' {
	return cognitionPath.replace(/\\/g, '/').endsWith('README.md') ? 'folder' : 'leaf';
}

async function checkSourceCandidateState(
	fs: FileSystem,
	cognitionUri: UriComponents,
	sourceRootUri: UriComponents | undefined,
	cognitionRootUri: UriComponents,
): Promise<SourceCandidateState> {
	if (!sourceRootUri) {
		return 'unchecked';
	}

	// No inferrable candidate means the existence check cannot run; that is
	// not evidence that the source is missing.
	const candidates = inferSourceUriCandidatesFromCognitionUri(cognitionUri, sourceRootUri, cognitionRootUri);
	if (candidates.length === 0) {
		return 'unchecked';
	}
	if (candidates.length > 1) {
		return 'ambiguous';
	}

	return await fs.stat(candidates[0]) ? 'some-exist' : 'all-missing';
}
