import * as path from './path-utils';
import type { UriComponents } from './interfaces';
import { joinUriPath, uriRelativePath, uriBasename, uriKey } from './uri-utils';
import type { CoggitConfig, CoggitWorkspaceRoot } from './types';

/**
 * Path and URI mapping helpers.
 *
 * String helpers are kept for pure path tests and file-scheme callers. URI helpers
 * are the production API for workspace roots and cognition targets so remote, WSL,
 * and dev-container schemes are preserved end-to-end.
 */

// ─── Project roots ────────────────────────────────────────────────────────

/**
 * Derive the project root path from a config.yaml path.
 * Convention: .coggit/config.yaml → project root is the parent of .coggit/.
 */
export function getProjectRootPath(configPath: string): string {
  return path.resolve(path.dirname(configPath), '..');
}

/**
 * Resolve sourceRoot / cognitionRoot from a config URI without converting through
 * fsPath → path.resolve → Uri.file. This preserves the original URI scheme.
 */
export function resolveConfigRoots(
  configUri: UriComponents,
  config: CoggitConfig,
): {
  projectRootUri: UriComponents;
  sourceRootUri: UriComponents;
  cognitionRootUri: UriComponents;
} {
  const projectRootUri = joinUriPath(configUri, '..', '..');
  return {
    projectRootUri,
    sourceRootUri: resolveUri(projectRootUri, config.sourceRoot),
    cognitionRootUri: resolveUri(projectRootUri, config.cognitionRoot),
  };
}

/**
 * Resolve sourceRoot / cognitionRoot as file-system paths.
 * Prefer resolveConfigRoots() in VS Code-facing code.
 */
export function resolveConfigRootPaths(
  configPath: string,
  config: CoggitConfig,
): {
  projectRoot: string;
  sourceRoot: string;
  cognitionRoot: string;
} {
  const projectRoot = getProjectRootPath(configPath);
  return {
    projectRoot,
    sourceRoot: resolvePath(projectRoot, config.sourceRoot),
    cognitionRoot: resolvePath(projectRoot, config.cognitionRoot),
  };
}

export function resolvePath(
  basePath: string,
  targetPath: string,
): string {
  if (path.isAbsolute(targetPath)) {
    return path.normalize(targetPath);
  }

  return path.resolve(basePath, targetPath);
}

function resolveUri(baseUri: UriComponents, targetPath: string): UriComponents {
  if (isAbsoluteFsPath(targetPath)) {
    return { ...baseUri, path: normalizeUriPath(targetPath) };
  }

  const segments = normalizePath(targetPath)
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  return segments.length === 0
    ? baseUri
    : joinUriPath(baseUri, ...segments);
}

function isAbsoluteFsPath(targetPath: string): boolean {
  return path.posix.isAbsolute(targetPath) || path.win32.isAbsolute(targetPath);
}

function normalizeUriPath(targetPath: string): string {
  const normalized = normalizePath(targetPath);
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

// ─── Relative paths ───────────────────────────────────────────────────────────

/**
 * sourcePath relative to sourceRoot, normalized to / separators.
 */
export function toRelativePath(
  sourceRootPath: string,
  sourcePath: string,
): string {
  return normalizePath(path.relative(sourceRootPath, sourcePath));
}

export function toRelativeUriPath(
  rootUri: UriComponents,
  uri: UriComponents,
): string {
  const relativePath = uriRelativePath(rootUri, uri);
  if (relativePath === undefined) {
    throw new Error(`URI is not under root: ${uriKey(uri)} is not under ${uriKey(rootUri)}`);
  }
  return relativePath;
}

/**
 * Normalize an operation `sourcePath` input to a source identity.
 *
 * The operation-DTO input surface is project-root-relative; this is the single
 * place that strips the configured `sourceRoot` prefix back to the
 * source-root-relative identity used for tree matching. Non-prefixed paths pass
 * through unchanged as the legacy source-root-relative fallback.
 */
export function normalizeSourcePathInput(
  sourcePath: string,
  context?: {
    sourceRoot?: string;
    projectRootUri?: UriComponents;
    sourceRootUri?: UriComponents;
  },
): string {
  const normalizedPath = trimSlashes(sourcePath.replace(/\\/g, '/'));
  if (normalizedPath === '' || normalizedPath === '.') {
    return normalizedPath;
  }

  const sourceRoot = context?.sourceRoot
    ? trimSlashes(context.sourceRoot.replace(/\\/g, '/'))
    : sourceRootPrefixFromUris(context);
  if (!sourceRoot || sourceRoot === '.') {
    return normalizedPath;
  }
  if (normalizedPath === sourceRoot) {
    return '.';
  }
  if (normalizedPath.startsWith(sourceRoot + '/')) {
    return normalizedPath.slice(sourceRoot.length + 1) || '.';
  }
  return normalizedPath;
}

function sourceRootPrefixFromUris(context?: {
  projectRootUri?: UriComponents;
  sourceRootUri?: UriComponents;
}): string | undefined {
  if (!context?.projectRootUri || !context.sourceRootUri) {
    return undefined;
  }
  return toRelativeUriPath(context.projectRootUri, context.sourceRootUri);
}

function trimSlashes(input: string): string {
  return input.replace(/^\/+|\/+$/gu, '');
}

// ─── source → cognition mapping ────────────────────────────────────────

/**
 * The single source↔cognition pairing convention. Written once here and reused
 * by key derivation (`identity.ts`), URI mapping (below), and reverse inference.
 *
 * - Leaf:      `sourceIdentity + ".md"`
 * - Skeleton:  `sourceIdentity + "/README.md"` (root `.` → `README.md`)
 */
export type CognitionIdentityKind = 'leaf' | 'folder';

export function sourceIdentityToCognitionIdentity(
  sourceIdentity: string,
  kind: CognitionIdentityKind,
): string {
  const identity = sourceIdentity === '' ? '.' : sourceIdentity;
  if (kind === 'leaf') {
    return `${identity}.md`;
  }
  return identity === '.' ? 'README.md' : `${identity}/README.md`;
}

/**
 * Reverse of {@link sourceIdentityToCognitionIdentity}. Returns `undefined` for
 * free-form cognition documents (e.g. `CODE_MAP.md`) that have no source-pairing
 * convention.
 */
export function cognitionIdentityToSourceIdentity(
  cognitionIdentity: string,
): { sourceIdentity: string; kind: CognitionIdentityKind } | undefined {
  const normalized = cognitionIdentity.replace(/\\/g, '/');
  if (!normalized.endsWith('.md')) {
    return undefined;
  }

  const withoutMd = normalized.slice(0, -'.md'.length);
  if (withoutMd === '') {
    return undefined;
  }
  if (withoutMd === 'README') {
    return { sourceIdentity: '.', kind: 'folder' };
  }

  const lastSegment = withoutMd.split('/').pop()!;
  if (lastSegment === 'README') {
    return {
      sourceIdentity: withoutMd.slice(0, -'/README'.length) || '.',
      kind: 'folder',
    };
  }

  // Only `<source>.<ext>.md` (a source-like extension before `.md`) is a paired
  // leaf cognition file. Dotfile sources (e.g. `.eslintrc.js`) stay paired when
  // an extension follows the leading dot.
  const hasSourceExtension = lastSegment.startsWith('.')
    ? lastSegment.slice(1).includes('.')
    : lastSegment.includes('.');
  if (!hasSourceExtension) {
    return undefined;
  }

  return { sourceIdentity: withoutMd, kind: 'leaf' };
}

/**
 * source file → cognition markdown file path.
 * Example: src/foo/bar.ts → src_cognition/foo/bar.ts.md
 */
export function toCognitionFilePath(
  sourceRootPath: string,
  cognitionRootPath: string,
  sourceFilePath: string,
): string {
  const rel = toRelativePath(sourceRootPath, sourceFilePath);
  return path.join(cognitionRootPath, sourceIdentityToCognitionIdentity(rel, 'leaf'));
}

export function toCognitionFileUri(
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
  sourceFileUri: UriComponents,
): UriComponents {
  const rel = toRelativeUriPath(sourceRootUri, sourceFileUri);
  return joinIdentityPath(cognitionRootUri, sourceIdentityToCognitionIdentity(rel, 'leaf'));
}

/**
 * source folder → cognition README path.
 * Example: src/foo → src_cognition/foo/README.md
 */
export function toCognitionFolderReadmePath(
  sourceRootPath: string,
  cognitionRootPath: string,
  folderPath: string,
): string {
  const rel = toRelativePath(sourceRootPath, folderPath);
  return path.join(cognitionRootPath, sourceIdentityToCognitionIdentity(rel, 'folder'));
}

export function toCognitionFolderReadmeUri(
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
  folderUri: UriComponents,
): UriComponents {
  const rel = toRelativeUriPath(sourceRootUri, folderUri);
  return joinIdentityPath(cognitionRootUri, sourceIdentityToCognitionIdentity(rel, 'folder'));
}

export function inferSourceUriFromCognitionUri(
  cognitionUri: UriComponents,
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
): UriComponents | undefined {
  const candidates = inferSourceUriCandidatesFromCognitionUri(cognitionUri, sourceRootUri, cognitionRootUri);
  return candidates[0];
}

export function inferSourceUriCandidatesFromCognitionUri(
  cognitionUri: UriComponents,
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
): UriComponents[] {
  const relativePath = toRelativeUriPath(cognitionRootUri, cognitionUri);
  if (relativePath === '.') {
    return [];
  }

  const mapped = cognitionIdentityToSourceIdentity(relativePath);
  if (!mapped) {
    return [];
  }

  return [joinIdentityPath(sourceRootUri, mapped.sourceIdentity)];
}

// ─── Identity ↔ project-relative coordinate conversion ─────────────────────

/**
 * Convert a source-root-relative identity to a project-root-relative path by
 * prepending the configured `sourceRoot` name (skipped when the root is `.`).
 */
export function sourceIdentityToProjectRelative(
  root: CoggitWorkspaceRoot,
  sourceIdentity: string,
): string {
  return prependRootName(rootName(root.projectRootUri, root.sourceRootUri), sourceIdentity);
}

export function cognitionIdentityToProjectRelative(
  root: CoggitWorkspaceRoot,
  cognitionIdentity: string,
): string {
  return prependRootName(rootName(root.projectRootUri, root.cognitionRootUri), cognitionIdentity);
}

/**
 * Convert a project-root-relative path back to a source identity by stripping
 * the configured `sourceRoot` name. Non-prefixed paths pass through unchanged
 * (the legacy source-root-relative fallback).
 */
export function projectRelativeToSourceIdentity(
  root: CoggitWorkspaceRoot,
  projectRelative: string,
): string {
  return stripRootName(rootName(root.projectRootUri, root.sourceRootUri), projectRelative);
}

function rootName(projectRootUri: UriComponents, rootUri: UriComponents): string {
  return toRelativeUriPath(projectRootUri, rootUri);
}

function prependRootName(rootName: string, identity: string): string {
  if (rootName === '.' || rootName === '') {
    return identity === '' ? '.' : identity;
  }
  if (identity === '.' || identity === '') {
    return rootName;
  }
  return `${rootName}/${identity}`;
}

function stripRootName(rootName: string, projectRelative: string): string {
  const normalized = projectRelative.replace(/\\/g, '/').replace(/^\/+|\/+$/gu, '');
  if (rootName === '.' || rootName === '') {
    return normalized === '' ? '.' : normalized;
  }
  if (normalized === rootName) {
    return '.';
  }
  if (normalized.startsWith(`${rootName}/`)) {
    return normalized.slice(rootName.length + 1) || '.';
  }
  return normalized;
}

function joinIdentityPath(base: UriComponents, identity: string): UriComponents {
  const segments = identity
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  return segments.length === 0 ? base : joinUriPath(base, ...segments);
}

// ─── Directory / containment ────────────────────────────────────────────────────

export function getParentDir(filePath: string): string {
  return path.dirname(filePath);
}

export function isWithin(
  parentPath: string,
  childPath: string,
): boolean {
  const rel = path.relative(parentPath, childPath);
  return (
    rel === '' ||
    (!rel.startsWith('..') && !path.isAbsolute(rel))
  );
}

export function basename(filePath: string): string {
  return path.basename(filePath);
}

// ─── Internal utilities ─────────────────────────────────────────────────────────

function normalizePath(targetPath: string): string {
  const normalized = targetPath.replace(/\\/g, '/');
  return normalized === '' ? '.' : normalized;
}
