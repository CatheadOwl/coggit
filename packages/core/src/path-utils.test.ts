import * as assert from 'assert';

import { resolve } from './path-utils';

suite('path-utils resolve', () => {
	test('resolves relative path after absolute base', () => {
		assert.strictEqual(resolve('/a', 'b'), '/a/b');
	});

	test('resolves multiple relative segments', () => {
		assert.strictEqual(resolve('/a', 'b', 'c'), '/a/b/c');
	});

	test('uses rightmost absolute segment as resolved base', () => {
		assert.strictEqual(resolve('/a', '/b'), '/b');
	});

	test('normalizes dot segments', () => {
		assert.strictEqual(resolve('/a/b', './c'), '/a/b/c');
	});

	test('resolves parent-dotdot correctly', () => {
		assert.strictEqual(resolve('/a/b/c', '../../d'), '/a/d');
	});

	test('returns last segment when given a single segment', () => {
		assert.strictEqual(resolve('foo'), 'foo');
	});

	test('returns root when given root and relative', () => {
		assert.strictEqual(resolve('/', 'foo'), '/foo');
	});

	test('handles empty segments gracefully', () => {
		assert.strictEqual(resolve('/a', '', 'b'), '/a/b');
	});
});
