import * as assert from 'assert';
import * as vscode from 'vscode';

import { calculateAffected } from '../affected';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '../types';
import { uriKey } from '../../runtime/vscode/adapter/uri';
import { buildMappingIndex } from './mappingIndex';

suite('mapping index URI identity', () => {
	test('builds mapping index with URI identity strings', () => {
		const sourceRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src');
		const cognitionRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog');
		const sourceUri = vscode.Uri.joinPath(sourceRoot, 'foo.ts');
		const cognitionUri = vscode.Uri.joinPath(cognitionRoot, 'foo.md');
		const root: CoggitWorkspaceRoot = {
			id: 'root',
			label: 'root',
			workspaceFolder: {
				uri: {
					scheme: 'vscode-remote',
					authority: 'ssh-remote%2Bbox',
					path: '/workspace/project',
					query: '',
					fragment: '',
				},
				name: 'project',
				index: 0,
			},
			configUri: vscode.Uri.joinPath(
				vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project'),
				'.coggit',
				'config.yaml',
			),
			projectRootUri: vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project'),
			sourceRootUri: sourceRoot,
			cognitionRootUri: cognitionRoot,
		};
		const node: CoggitTreeNode = {
			id: uriKey(sourceUri),
			kind: 'file',
			label: 'foo.ts',
			resourceUri: sourceUri,
			sourceUri,
			cognitionUri,
			relativePath: 'foo.ts',
			contextValue: 'coggitFilePresent',
			root,
		};

		const remoteMapping = buildMappingIndex([node]);
		const sourceKey = uriKey(sourceUri);
		const cognitionKey = uriKey(cognitionUri);

		assert.deepStrictEqual(remoteMapping.sourceToCognition.get(sourceKey), [cognitionKey]);
		assert.strictEqual(remoteMapping.cognitionToSource.get(cognitionKey), sourceKey);
		assert.strictEqual(calculateAffected([cognitionKey], remoteMapping).pairs[0].sourcePath, sourceKey);
	});
});
