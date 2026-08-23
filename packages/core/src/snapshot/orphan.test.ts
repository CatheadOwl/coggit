import * as assert from 'node:assert';

import { detectStrayCognitionEntries } from './orphan';

suite('snapshot/orphan compatibility boundary', () => {
	test('exports the scan-backed detector under stray semantics only', () => {
		assert.strictEqual(typeof detectStrayCognitionEntries, 'function');
	});
});
