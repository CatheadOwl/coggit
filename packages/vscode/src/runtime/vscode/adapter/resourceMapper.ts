import * as vscode from 'vscode';

import { uriKey } from './uri';

export const COGGIT_RESOURCE_SCHEME = 'coggit';

export function toCoggitResourceUri(uri: vscode.Uri): vscode.Uri {
	return vscode.Uri.from({
		scheme: COGGIT_RESOURCE_SCHEME,
		path: uri.path,
		query: encodeURIComponent(uriKey(uri)),
	});
}

export function fromCoggitResourceUri(uri: vscode.Uri): vscode.Uri {
	if (uri.scheme !== COGGIT_RESOURCE_SCHEME || uri.query.length === 0) {
		throw new Error(`Invalid Coggit resource URI: ${uri.toString()}`);
	}
	return vscode.Uri.parse(decodeURIComponent(uri.query));
}
