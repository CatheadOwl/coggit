import type { FileSystem, UriComponents } from '../interfaces';
import type { CoggitWorkspaceRoot, PathKeyRecord } from '../types';
import { cognitionPathToKey } from '../identity';
import { toCognitionFileUri, toCognitionFolderReadmeUri } from '../mapping';
import { joinUriPath, uriRelativePath } from '../uri-utils';
import type { Registry } from '../registry/index';
import { LEAF_HANDBOOK, SKELETON_HANDBOOK, SYSTEM_HANDBOOK } from './handbooks';
import { LEAF_TEMPLATE, SKELETON_TEMPLATE } from './templates';

export type CognitionKind = 'leaf' | 'skeleton';
export type AddCognitionKind = CognitionKind | 'auto';

export interface AddCognitionOptions {
  kind?: AddCognitionKind;
  overwrite?: boolean;
}

export interface AddCognitionResult {
  kind: CognitionKind;
  sourcePath: string;
  cognitionPath: string;
  cognitionUri: UriComponents;
  created: boolean;
}

export interface CognitionTemplate {
  kind: CognitionKind;
  version: 'skeleton-leaf-v3';
  content: string;
}

export interface CognitionHandbook {
  kind: CognitionKind | 'all';
  version: 'skeleton-leaf-v3';
  content: string;
}

export async function addCognition(
  root: CoggitWorkspaceRoot,
  fs: FileSystem,
  registry: Registry | null,
  sourcePath: string,
  options: AddCognitionOptions = {},
): Promise<AddCognitionResult> {
  const sourceUri = joinRelativePath(root.sourceRootUri, sourcePath);
  const sourceStat = await fs.stat(sourceUri);
  if (!sourceStat) {
    throw new Error(`Source path not found: ${sourcePath}`);
  }

  const kind = resolveCognitionKind(sourceStat.isDirectory, options.kind ?? 'auto');
  const cognitionUri = kind === 'skeleton'
    ? toCognitionFolderReadmeUri(root.sourceRootUri, root.cognitionRootUri, sourceUri)
    : toCognitionFileUri(root.sourceRootUri, root.cognitionRootUri, sourceUri);
  const cognitionPath = requireRelativePath(root.projectRootUri, cognitionUri, 'cognition');
  const sourceProjectPath = requireRelativePath(root.projectRootUri, sourceUri, 'source');
  const sourceRootPath = requireRelativePath(root.sourceRootUri, sourceUri, 'source');

  const exists = await fs.exists(cognitionUri);
  if (!exists || options.overwrite === true) {
    await fs.createDirectory(parentUri(cognitionUri));
    await fs.writeFile(
      cognitionUri,
      renderCognitionTemplate(kind, {
        name: sourceRootPath === '.' ? root.label : basename(sourceRootPath),
        sourcePath: sourceProjectPath,
      }),
    );
  }

  if (registry) {
    const cognitionRootPath = requireRelativePath(root.cognitionRootUri, cognitionUri, 'cognition');
    const key = cognitionPathToKey(cognitionRootPath);
    const existing = registry.getEntry(key);
    const entry: PathKeyRecord = {
      sourcePath: sourceProjectPath,
      type: kind === 'skeleton' ? 'folder' : 'leaf',
      accepted: existing?.accepted ?? null,
      cognitionBlobHash: existing?.cognitionBlobHash ?? null,
      cognitionLength: existing?.cognitionLength ?? null,
    };
    registry.setEntry(key, entry, 'add-cognition');
    await registry.flush();
  }

  return {
    kind,
    sourcePath: sourceProjectPath,
    cognitionPath,
    cognitionUri,
    created: !exists || options.overwrite === true,
  };
}

export function getCognitionTemplate(kind: CognitionKind): CognitionTemplate {
  return {
    kind,
    version: 'skeleton-leaf-v3',
    content: kind === 'skeleton' ? SKELETON_TEMPLATE : LEAF_TEMPLATE,
  };
}

export function getCognitionHandbook(kind: CognitionKind): CognitionHandbook;
/**
 * @deprecated The aggregate handbook is retained only for CLI compatibility.
 * Use the node-kind handbooks ('leaf' or 'skeleton') for maintained guidance.
 */
export function getCognitionHandbook(kind?: 'all'): CognitionHandbook;
export function getCognitionHandbook(kind: CognitionKind | 'all' = 'all'): CognitionHandbook {
  if (kind === 'leaf') {
    return { kind, version: 'skeleton-leaf-v3', content: LEAF_HANDBOOK };
  }
  if (kind === 'skeleton') {
    return { kind, version: 'skeleton-leaf-v3', content: SKELETON_HANDBOOK };
  }
  return {
    kind,
    version: 'skeleton-leaf-v3',
    content: SYSTEM_HANDBOOK,
  };
}

function resolveCognitionKind(isDirectory: boolean, requested: AddCognitionKind): CognitionKind {
  if (requested === 'auto') {
    return isDirectory ? 'skeleton' : 'leaf';
  }
  if (requested === 'leaf' && isDirectory) {
    throw new Error('Cannot create leaf cognition for a directory.');
  }
  if (requested === 'skeleton' && !isDirectory) {
    throw new Error('Cannot create skeleton cognition for a file.');
  }
  return requested;
}

function renderCognitionTemplate(
  kind: CognitionKind,
  context: { name: string; sourcePath: string },
): string {
  const title = kind === 'skeleton'
    ? `${context.name} Layer`
    : `${context.name} - Role`;
  const name = toKebabName(context.name);
  const description = kind === 'skeleton'
    ? `Cognition skeleton for ${context.sourcePath}`
    : `Cognition leaf for ${context.sourcePath}`;

  return getCognitionTemplate(kind).content
    .replaceAll('<kebab-case-folder-name>', name)
    .replaceAll('<kebab-case-leaf-name>', name)
    .replaceAll('<one-line identity of this folder or layer>', description)
    .replaceAll('<one-line role of this source file>', description)
    .replaceAll('<Folder or Layer Name>', title)
    .replaceAll('<source-file>', context.sourcePath);
}

function requireRelativePath(
  rootUri: UriComponents,
  childUri: UriComponents,
  label: string,
): string {
  const relativePath = uriRelativePath(rootUri, childUri);
  if (relativePath === undefined) {
    throw new Error(`Resolved ${label} path is outside project root.`);
  }
  return relativePath;
}

function joinRelativePath(rootUri: UriComponents, relativePath: string): UriComponents {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) =>
    segment.length > 0 && segment !== '.',
  );
  return segments.length === 0
    ? rootUri
    : joinUriPath(rootUri, ...segments);
}

function parentUri(uri: UriComponents): UriComponents {
  const path = uri.path.replace(/\/+$/u, '');
  const idx = path.lastIndexOf('/');
  return {
    ...uri,
    path: idx >= 0 ? path.slice(0, idx) || '/' : '/',
  };
}

function basename(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+$/u, '');
  return normalized.split('/').pop() || normalized;
}

function toKebabName(value: string): string {
  return value
    .replace(/\.[^.]+$/u, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .toLowerCase() || 'cognition';
}
