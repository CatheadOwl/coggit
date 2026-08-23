import * as assert from 'assert';

import { computeBlobHash, computeCognitionIdentity, computeContentIdentity, computeSourceFactIdentity } from './hash';

suite('blob hash', () => {
	test('produces deterministic SHA256 hash', () => {
		const hash1 = computeBlobHash('hello');
		const hash2 = computeBlobHash('hello');
		assert.strictEqual(hash1, hash2);
	});

	test('produces different hash for different content', () => {
		const hash1 = computeBlobHash('hello');
		const hash2 = computeBlobHash('world');
		assert.notStrictEqual(hash1, hash2);
	});

	test('produces 64-char hex string', () => {
		const hash = computeBlobHash('test content');
		assert.strictEqual(hash.length, 64);
		assert.match(hash, /^[0-9a-f]{64}$/);
	});
});

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
