import * as assert from 'assert';

import { computeRuntimeStatus, describeObservedStatus } from './status';
import { computeCognitionIdentity, computeSourceFactIdentity } from './hash';
import type { ObservedStatus } from './types';

suite('runtime status adapter', () => {
	test('computes runtime status with URI evidence identities', () => {
		const sourceUri = 'vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo.ts';
		const cognitionUri = 'vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog/foo.md';

		const result = computeRuntimeStatus({
			sourceUri,
			sourceContent: 'export const value = 1;\n',
			sourceMtimeMs: 1000,
			cognitionUri,
			cognitionContent: '# Foo\n\nUseful implementation notes.\nMore context.\n',
			cognitionMtimeMs: 2000,
		});

		assert.strictEqual(result.observedStatus, 'fresh');
		assert.strictEqual(result.evidence.sourceBlobHash, computeSourceFactIdentity('file-content', 'export const value = 1;\n'));
	});

	test('detects runtime template cognition', () => {
		const result = computeRuntimeStatus({
			sourceUri: 'file:///workspace/src/foo.ts',
			sourceContent: 'export const value = 1;\n',
			sourceMtimeMs: 1000,
			cognitionUri: 'file:///workspace/src_cog/foo.md',
			cognitionContent: '# Foo\n',
			cognitionMtimeMs: 2000,
		});

		assert.strictEqual(result.observedStatus, 'stale');
	});

	test('reports folder structure drift as a folder-specific diagnostic', () => {
		const result = computeRuntimeStatus({
			sourceUri: 'file:///workspace/src/foo',
			sourceContent: 'bar.ts\nbaz/',
			sourceFactKind: 'directory-entry',
			sourceMtimeMs: 1000,
			cognitionUri: 'file:///workspace/src_cog/foo/README.md',
			cognitionContent: '# Foo\n\nThis folder README documents the module boundary and child layout.\n\nIt is maintained cognition content.',
			cognitionMtimeMs: 2000,
			verificationTimeMs: 3000,
		});

		assert.strictEqual(result.observedStatus, 'fresh');
		assert.strictEqual(result.issues.length, 0);
	});

	test('uses accepted content identities instead of mtimes', () => {
		const source = 'export const value = 1;';
		const cognition = '# Foo\n\nMaintained notes.\n\nIt remains current.';
		const accepted = {
			source: computeSourceFactIdentity('file-content', source),
			cognition: computeCognitionIdentity(cognition),
		};
		const result = computeRuntimeStatus({
			sourceUri: 'file:///src/foo.ts',
			sourceContent: source,
			sourceMtimeMs: 1000,
			cognitionUri: 'file:///cog/foo.ts.md',
			cognitionContent: cognition,
			cognitionMtimeMs: 5000,
			acceptedPair: accepted,
		});
		assert.strictEqual(result.observedStatus, 'fresh');
		assert.deepStrictEqual(result.issues, []);
	});

	test('reports both changed identities as stale without ordering evidence', () => {
		const result = computeRuntimeStatus({
			sourceUri: 'file:///src/foo.ts',
			sourceContent: 'export const value = 2;',
			sourceMtimeMs: 5000,
			cognitionUri: 'file:///cog/foo.ts.md',
			cognitionContent: '# Foo\n\nNew notes.',
			cognitionMtimeMs: 1000,
			acceptedPair: {
				source: computeSourceFactIdentity('file-content', 'export const value = 1;'),
				cognition: computeCognitionIdentity('# Foo\n\nOld notes.'),
			},
		});
		assert.strictEqual(result.observedStatus, 'stale');
		assert.strictEqual(result.issues[0]?.diagnostic.code, 'outdated-cognition');
	});

	test('reports folder README mtime drift as a folder-specific diagnostic', () => {
		const result = computeRuntimeStatus({
			sourceUri: 'file:///workspace/src/foo',
			sourceContent: 'bar.ts',
			sourceFactKind: 'directory-entry',
			sourceMtimeMs: 2000,
			cognitionUri: 'file:///workspace/src_cog/foo/README.md',
			cognitionContent: '# Foo\n\nThis folder README documents the module boundary and child layout.\n\nIt is maintained cognition content.',
			cognitionMtimeMs: 1000,
		});

		assert.strictEqual(result.observedStatus, 'fresh');
		assert.deepStrictEqual(result.issues, []);
	});
});

suite('describeObservedStatus', () => {
	test('describes all observed status states', () => {
		const states: ObservedStatus[] = ['fresh', 'stale', 'conflict'];
		for (const state of states) {
			assert.ok(typeof describeObservedStatus(state) === 'string', `State ${state} should have a description`);
		}
	});

	test('returns undefined for unknown state', () => {
		assert.strictEqual(describeObservedStatus(undefined), undefined);
	});
});
