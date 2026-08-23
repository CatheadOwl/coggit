import type { FileSystem } from './interfaces';
import type {
  CoggitWorkspaceRoot,
  MisplacedCognitionEntry,
  PathKeyRecord,
} from './types';
import { keyToCognitionPath } from './identity';
import {
  toCognitionFileUri,
  toCognitionFolderReadmeUri,
} from './mapping';
import { joinUriPath, uriRelativePath } from './uri-utils';

export async function detectMisplacedCognitionEntries(
  root: CoggitWorkspaceRoot,
  fs: FileSystem,
  entries: Record<string, PathKeyRecord>,
): Promise<MisplacedCognitionEntry[]> {
  const misplaced: MisplacedCognitionEntry[] = [];

  for (const [registryKey, entry] of Object.entries(entries)) {
    const sourcePath = entry.sourcePath;
    if (sourcePath === null) {
      continue;
    }

      const sourceUri = joinRelativePath(root.projectRootUri, sourcePath);
      const sourceStat = await fs.stat(sourceUri);
      if (!sourceStat) {
        continue;
      }

      const actualCognitionUri = joinRelativePath(
        root.cognitionRootUri,
        keyToCognitionPath(registryKey, entry.type),
      );
      const cognitionStat = await fs.stat(actualCognitionUri);
      if (!cognitionStat) {
        continue;
      }

      const expectedCognitionUri = entry.type === 'folder'
        ? toCognitionFolderReadmeUri(
          root.sourceRootUri,
          root.cognitionRootUri,
          sourceUri,
        )
        : toCognitionFileUri(
          root.sourceRootUri,
          root.cognitionRootUri,
          sourceUri,
        );
      const expectedCognitionPath = uriRelativePath(
        root.projectRootUri,
        expectedCognitionUri,
      );
      if (expectedCognitionPath === undefined) {
        continue;
      }

      const actualCognitionPath = uriRelativePath(
        root.projectRootUri,
        actualCognitionUri,
      );
      if (actualCognitionPath === undefined) {
        continue;
      }

      if (actualCognitionPath === expectedCognitionPath) {
        continue;
      }

      misplaced.push({
        registryKey,
        type: entry.type,
        sourcePath,
        sourceUri,
        actualCognitionPath,
        actualCognitionUri,
        expectedCognitionPath,
        expectedCognitionUri,
      });
  }

  return misplaced;
}

function joinRelativePath(
  rootUri: Parameters<typeof joinUriPath>[0],
  relativePath: string,
): ReturnType<typeof joinUriPath> {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) =>
    segment.length > 0 && segment !== '.',
  );
  return segments.length === 0
    ? rootUri
    : joinUriPath(rootUri, ...segments);
}
