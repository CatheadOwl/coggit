import * as assert from 'assert';

import { computeCognitionIdentity, computeContentIdentity, computeSourceFactIdentity } from './hash';

suite('versioned content identity', () => {
	test('uses the stable sha256:v1 envelope', () => {
		const identity = computeContentIdentity('leaf', 'hello');
		assert.match(identity, /^sha256:v1:[0-9a-f]{64}$/u);
	});

	test('does not normalize line endings or domains', () => {
		assert.notStrictEqual(computeCognitionIdentity('a\n'), computeCognitionIdentity('a\r\n'));
		assert.notStrictEqual(computeCognitionIdentity('same'), computeSourceFactIdentity('file-content', 'same'));
	});

	test('uses the folder source-fact domain', () => {
		assert.match(computeSourceFactIdentity('directory-entry', 'file:1:a\n'), /^sha256:v1:/u);
	});
});
