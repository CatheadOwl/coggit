import * as path from './path-utils';
import type { UriComponents } from './interfaces';
import { joinUriPath, uriRelativePath, uriBasename, uriKey } from './uri-utils';
import type { CoggitConfig } from './types';

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
 * source file → cognition markdown file path.
 * Example: src/foo/bar.ts → src_cognition/foo/bar.ts.md
 */
export function toCognitionFilePath(
  sourceRootPath: string,
  cognitionRootPath: string,
  sourceFilePath: string,
): string {
  const rel = toRelativePath(sourceRootPath, sourceFilePath);
  return path.join(cognitionRootPath, rel + '.md');
}

export function toCognitionFileUri(
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
  sourceFileUri: UriComponents,
): UriComponents {
  const rel = toRelativeUriPath(sourceRootUri, sourceFileUri);
  return joinUriPath(cognitionRootUri, rel + '.md');
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
  return rel === '.'
    ? path.join(cognitionRootPath, 'README.md')
    : path.join(cognitionRootPath, rel, 'README.md');
}

export function toCognitionFolderReadmeUri(
  sourceRootUri: UriComponents,
  cognitionRootUri: UriComponents,
  folderUri: UriComponents,
): UriComponents {
  const rel = toRelativeUriPath(sourceRootUri, folderUri);
  return rel === '.'
    ? joinUriPath(cognitionRootUri, 'README.md')
    : joinUriPath(cognitionRootUri, ...rel.split('/'), 'README.md');
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
  if (relativePath === '.' || !relativePath.toLowerCase().endsWith('.md')) {
    return [];
  }

  if (relativePath === 'README.md') {
    return [sourceRootUri];
  }

  const withoutExt = relativePath.slice(0, -'.md'.length);
  if (withoutExt.endsWith('/README')) {
    const folderRel = withoutExt.slice(0, -'/README'.length);
    return [folderRel.length === 0
      ? sourceRootUri
      : joinUriPath(sourceRootUri, ...folderRel.split('/'))];
  }

  // Standalone docs (e.g. MODULES.md) have no source-extension pattern.
  // Only files named <source>.<ext>.md are paired cognition files. Dotfile
  // sources (e.g. .eslintrc.js) stay paired when an extension follows the
  // leading dot.
  const basename = withoutExt.split('/').pop() || withoutExt;
  const hasSourceExtension = basename.startsWith('.')
    ? basename.slice(1).includes('.')
    : basename.includes('.');
  if (!hasSourceExtension) {
    return [];
  }

  // toCognitionFileUri does (rel + '.md'), so reverse is simply strip '.md'
  return [joinUriPath(sourceRootUri, withoutExt)];
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
