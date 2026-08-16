import * as assert from 'node:assert';

import {
	generatedSourceStructureGlobExclude,
	isIgnoredSourceStructureEntry,
} from './sourceStructureIgnore';

suite('source structure ignore', () => {
	test('ignores generated directories but not files with the same name', () => {
		assert.strictEqual(isIgnoredSourceStructureEntry('node_modules', true), true);
		assert.strictEqual(isIgnoredSourceStructureEntry('dist', true), true);
		assert.strictEqual(isIgnoredSourceStructureEntry('build', true), true);
		assert.strictEqual(isIgnoredSourceStructureEntry('vendor', true), true);
		assert.strictEqual(isIgnoredSourceStructureEntry('dist', false), false);
	});

	test('builds a VS Code recursive discovery exclude glob', () => {
		const exclude = generatedSourceStructureGlobExclude();

		assert.ok(exclude.startsWith('{'));
		assert.ok(exclude.endsWith('}'));
		assert.ok(exclude.includes('**/node_modules/**'));
		assert.ok(exclude.includes('**/.git/**'));
		assert.ok(exclude.includes('**/dist/**'));
	});
});
