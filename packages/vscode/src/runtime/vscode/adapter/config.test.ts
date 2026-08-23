import * as assert from 'node:assert';

import { buildConfigDiscoveryExclude } from './config';

suite('VscodeConfigProvider config discovery exclude', () => {
	test('combines files.exclude with generated directory excludes', () => {
		const exclude = buildConfigDiscoveryExclude({
			'**/.private/**': true,
			'**/disabled/**': false,
		});

		assert.ok(exclude.includes('**/.private/**'));
		assert.ok(exclude.includes('**/node_modules/**'));
		assert.ok(exclude.includes('**/dist/**'));
		assert.ok(!exclude.includes('**/disabled/**'));
	});
});
