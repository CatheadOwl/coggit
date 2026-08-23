import * as vscode from 'vscode';
import type { UriComponents, UriKey } from '@coggit/core';

export function toComponents(uri: vscode.Uri): UriComponents {
  return {
    scheme: uri.scheme,
    authority: uri.authority,
    path: uri.path,
    query: uri.query,
    fragment: uri.fragment,
  };
}

export function fromComponents(c: UriComponents): vscode.Uri {
  return vscode.Uri.from(c);
}

/**
 * Produces the canonical URI key string used by the core layer.
 * Uses manual string concatenation (not vscode.Uri.toString) to avoid
 * percent-encoding differences (e.g. `:` in Windows paths) that would
 * cause key mismatches with `nodeBySourceUri` lookups.
 */
export function uriKey(uri: vscode.Uri | UriComponents): UriKey {
  const { scheme, authority, path, query, fragment } = uri;
  return `${scheme}://${authority}${path}${query ? '?' + query : ''}${fragment ? '#' + fragment : ''}`;
}

/**
 * vscode.Uri.joinPath adapter (preserves scheme/authority).
 * Only used in adapter files — core uses string-based joinUriPath instead.
 */
export function joinUriPath(uri: vscode.Uri | UriComponents, ...segments: string[]): vscode.Uri {
  const u = isVscodeUri(uri) ? uri : vscode.Uri.from(uri);
  return vscode.Uri.joinPath(u, ...segments);
}

function isVscodeUri(uri: vscode.Uri | UriComponents): uri is vscode.Uri {
  return typeof (uri as any).toJSON === 'function';
}

/** Format a URI for user display */
export function formatUri(uri: vscode.Uri): string {
  return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

/** Guarded fsPath — only for file:// URIs */
export function localFsPath(uri: vscode.Uri): string {
  if (uri.scheme !== 'file') {
    throw new Error(`Expected file URI, got ${uri.toString()}`);
  }
  return uri.fsPath;
}

/** URI basename from path */
export function uriBasename(uri: vscode.Uri): string {
  const p = uri.path.replace(/\/+$/u, '');
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}

/** Compute relative path from root to child for vscode.Uri */
export function uriRelativePath(root: vscode.Uri, child: vscode.Uri): string | undefined {
  if (root.scheme !== child.scheme || root.authority !== child.authority) {
    return undefined;
  }
  const rootPath = root.path.replace(/\/+$/u, '');
  const childPath = child.path.replace(/\/+$/u, '');
  if (childPath === rootPath) {
    return '.';
  }
  const prefix = rootPath + '/';
  if (!childPath.startsWith(prefix)) {
    return undefined;
  }
  return childPath.slice(prefix.length) || '.';
}

/** Check if child URI is equal to or nested under parent URI */
export function isEqualOrChildUri(parent: vscode.Uri, child: vscode.Uri): boolean {
  return uriRelativePath(parent, child) !== undefined;
}
