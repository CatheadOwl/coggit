import type { UriComponents, UriKey } from './interfaces';

/** Produce a canonical URI key string from UriComponents */
export function uriKey(components: UriComponents): UriKey {
  return `${components.scheme}://${components.authority}${components.path}${components.query ? '?' + components.query : ''}${components.fragment ? '#' + components.fragment : ''}`;
}

/** Compute relative path from root to child, comparing scheme/authority/path */
export function uriRelativePath(root: UriComponents, child: UriComponents): string | undefined {
  if (root.scheme !== child.scheme || root.authority !== child.authority) {
    return undefined;
  }

  const rootPath = trimTrailingSlash(root.path);
  const childPath = trimTrailingSlash(child.path);
  if (childPath === rootPath) {
    return '.';
  }

  const prefix = rootPath + '/';
  if (!childPath.startsWith(prefix)) {
    return undefined;
  }

  return childPath.slice(prefix.length) || '.';
}

export function isEqualOrChildUri(parent: UriComponents, child: UriComponents): boolean {
  return uriRelativePath(parent, child) !== undefined;
}

/**
 * Join path segments onto a base URI, preserving scheme and authority.
 * This is a path-level operation (unlike vscode.Uri.joinPath which is URI-aware).
 */
export function joinUriPath(base: UriComponents, ...segments: string[]): UriComponents {
  let joined = trimTrailingSlash(base.path);
  for (const seg of segments) {
    if (seg === '..') {
      const idx = joined.lastIndexOf('/');
      if (idx > 0) {
        joined = joined.slice(0, idx);
      } else {
        joined = '/';
      }
    } else if (seg !== '.') {
      joined = joined === '/' ? '/' + seg : joined + '/' + seg;
    }
  }
  return { ...base, path: joined };
}

export function uriBasename(uri: UriComponents): string {
  const p = trimTrailingSlash(uri.path);
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function formatUri(uri: UriComponents): string {
  return uriKey(uri);
}

function trimTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/u, '') : value;
}

/**
 * Extract a clean, runtime-independent path string from UriComponents.
 *
 * For `file://` URIs the scheme prefix is stripped so callers get an
 * absolute path they can use directly or wrap in a runtime-specific URI.
 * Non-file URIs return the full URI key unchanged so no information is lost.
 *
 * This is the boundary transform at the MCP DTO layer — core internals keep
 * working with UriComponents; MCP-facing projections use this to decouple
 * the wire format from the `file://` scheme.
 */
export function uriToExternalPath(uri: UriComponents): string {
  if (uri.scheme === 'file') {
    // UriComponents.path for file:// URIs is `/d:/...` (Windows) or `/home/...` (Unix).
    // On Windows, strip the leading `/` so `file:///d:/foo` → `d:/foo`.
    const p = uri.path;
    if (/^\/[a-zA-Z]:[/\\]/u.test(p)) {
      return p.slice(1);
    }
    return p;
  }
  return uriKey(uri);
}

/**
 * Convert a URI key string (e.g. `"file:///d:/project"`) to a clean external
 * path suitable for MCP DTOs and CLI output.
 *
 * Inverse of `uriKey()` when the input was produced from a `file://` UriComponents.
 * Non-file URIs are returned as-is (no scheme stripping).
 */
export function externalPathFromString(uriKeyStr: string): string {
  if (uriKeyStr.startsWith('file://')) {
    const withoutScheme = uriKeyStr.slice(7);
    if (/^\/[a-zA-Z]:[/\\]/u.test(withoutScheme)) {
      return withoutScheme.slice(1);
    }
    return withoutScheme;
  }
  return uriKeyStr;
}

/** Parse a URI key string back into UriComponents. */
export function parseUriKey(uriKeyStr: string): UriComponents {
  const schemeEnd = uriKeyStr.indexOf('://');
  if (schemeEnd === -1) {
    throw new Error(`Invalid URI key: ${uriKeyStr}`);
  }
  const scheme = uriKeyStr.slice(0, schemeEnd);
  const rest = uriKeyStr.slice(schemeEnd + 3); // skip "://"
  const authEnd = rest.indexOf('/');
  const authority = authEnd === -1 ? rest : rest.slice(0, authEnd);
  const pathAndMaybeQuery = authEnd === -1 ? '' : rest.slice(authEnd);
  const qIdx = pathAndMaybeQuery.indexOf('?');
  const fIdx = pathAndMaybeQuery.indexOf('#');
  const pathEnd = qIdx !== -1 ? qIdx : fIdx !== -1 ? fIdx : pathAndMaybeQuery.length;
  const path = pathAndMaybeQuery.slice(0, pathEnd);
  const query = qIdx !== -1 ? pathAndMaybeQuery.slice(qIdx + 1, fIdx !== -1 ? fIdx : undefined) : '';
  const fragment = fIdx !== -1 ? pathAndMaybeQuery.slice(fIdx + 1) : '';
  return { scheme, authority, path: path || '/', query, fragment };
}
