import * as assert from 'assert';

import { calculateAffected } from '../affected';
import type { UriComponents } from '../interfaces';
import type { CoggitTreeNode, CoggitWorkspaceRoot } from '../types';
import { joinUriPath, uriKey } from '../uri-utils';
import { buildMappingIndex } from './mappingIndex';

suite('mapping index URI identity', () => {
	test('builds mapping index with URI identity strings', () => {
		const remoteRoot: UriComponents = {
			scheme: 'vscode-remote',
			authority: 'ssh-remote%2Bbox',
			path: '/workspace/project',
			query: '',
			fragment: '',
		};
		const sourceRoot = joinUriPath(remoteRoot, 'src');
		const cognitionRoot = joinUriPath(remoteRoot, 'src_cog');
		const sourceUri = joinUriPath(sourceRoot, 'foo.ts');
		const cognitionUri = joinUriPath(cognitionRoot, 'foo.md');
		const root: CoggitWorkspaceRoot = {
			id: 'root',
			label: 'root',
			workspaceFolder: {
				uri: remoteRoot,
				name: 'project',
				index: 0,
			},
			configUri: joinUriPath(remoteRoot, '.coggit', 'config.yaml'),
			projectRootUri: remoteRoot,
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
