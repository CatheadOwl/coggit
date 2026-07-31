import * as assert from 'assert';

import { selectWatchRefreshMode } from './watchRefreshPolicy';

suite('plugin watch refresh policy', () => {
	test('uses partial refresh for change events when a mapping index exists', () => {
		assert.strictEqual(selectWatchRefreshMode('change', true), 'partial');
	});

	test('uses full refresh for change events before a mapping index exists', () => {
		assert.strictEqual(selectWatchRefreshMode('change', false), 'full');
	});

	test('uses full refresh for create and delete events', () => {
		assert.strictEqual(selectWatchRefreshMode('create', true), 'full');
		assert.strictEqual(selectWatchRefreshMode('create', false), 'full');
		assert.strictEqual(selectWatchRefreshMode('delete', true), 'full');
		assert.strictEqual(selectWatchRefreshMode('delete', false), 'full');
	});
});
