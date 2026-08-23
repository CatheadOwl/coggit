import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { UriComponents } from '@coggit/core';

export function pathToUriComponents(filePath: string): UriComponents {
  const url = pathToFileURL(path.resolve(filePath));
  return {
    scheme: url.protocol.slice(0, -1),
    authority: url.host,
    path: url.pathname,
    query: url.search ? url.search.slice(1) : '',
    fragment: url.hash ? url.hash.slice(1) : '',
  };
}

export function uriComponentsToPath(uri: UriComponents): string {
  if (uri.scheme !== 'file') {
    throw new Error(`Node runtime only supports file URIs, received "${uri.scheme}"`);
  }

  const url = new URL('file://');
  url.hostname = uri.authority;
  url.pathname = uri.path;
  url.search = uri.query;
  url.hash = uri.fragment;
  return fileURLToPath(url);
}
