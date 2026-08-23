import * as assert from 'assert';

import { calculateAffected } from './affected';
import type { MappingIndex } from './types';

suite('affected calculation', () => {
	const mapping: MappingIndex = {
		sourceToCognition: new Map([
			['/src/foo.ts', ['/cog/foo.md']],
			['/src/bar.ts', ['/cog/bar.md']],
			['/src/baz.ts', ['/cog/baz.md']],
		]),
		cognitionToSource: new Map([
			['/cog/foo.md', '/src/foo.ts'],
			['/cog/bar.md', '/src/bar.ts'],
			['/cog/baz.md', '/src/baz.ts'],
		]),
		structuralEdges: [
			{ from: '/src/foo.ts', to: '/src/bar.ts', kind: 'sibling' },
		],
		semanticEdges: [],
	};

	test('resolves direct pairs for changed files', () => {
		const result = calculateAffected(['/src/foo.ts'], mapping);
		assert.strictEqual(result.stats.direct, 1);
		assert.strictEqual(result.pairs[0].sourcePath, '/src/foo.ts');
		assert.strictEqual(result.pairs[0].cognitionPath, '/cog/foo.md');
		assert.strictEqual(result.pairs[0].reason, 'direct');
	});

	test('includes structural pairs', () => {
		const result = calculateAffected(['/src/foo.ts'], mapping);
		assert.ok(result.stats.structural >= 1);
		const structural = result.pairs.filter((pair) => pair.reason === 'structural');
		assert.ok(structural.some((pair) => pair.sourcePath === '/src/bar.ts'));
	});

	test('deduplicates pairs across direct and structural', () => {
		const result = calculateAffected(['/src/foo.ts', '/src/bar.ts'], mapping);
		assert.strictEqual(result.stats.total, 2);
	});

	test('handles empty changed paths', () => {
		const result = calculateAffected([], mapping);
		assert.strictEqual(result.stats.total, 0);
	});

	test('handles unknown paths gracefully', () => {
		const result = calculateAffected(['/src/unknown.ts'], mapping);
		assert.strictEqual(result.stats.total, 0);
	});

	test('resolves direct pairs from changed cognition paths', () => {
		const result = calculateAffected(['/cog/foo.md'], mapping);
		assert.strictEqual(result.stats.direct, 1);
		assert.strictEqual(result.pairs[0].sourcePath, '/src/foo.ts');
		assert.strictEqual(result.pairs[0].cognitionPath, '/cog/foo.md');
		assert.strictEqual(result.pairs[0].reason, 'direct');
	});

	test('deduplicates structural and semantic overlap by pair identity', () => {
		const overlapping: MappingIndex = {
			sourceToCognition: new Map([
				['/src/foo.ts', ['/cog/foo.md']],
				['/src/bar.ts', ['/cog/bar.md']],
			]),
			cognitionToSource: new Map([
				['/cog/foo.md', '/src/foo.ts'],
				['/cog/bar.md', '/src/bar.ts'],
			]),
			structuralEdges: [{ from: '/src/foo.ts', to: '/src/bar.ts', kind: 'sibling' }],
			semanticEdges: [{ from: '/src/foo.ts', to: '/src/bar.ts', kind: 'link' }],
		};

		const result = calculateAffected(['/src/foo.ts'], overlapping);
		assert.strictEqual(
			result.pairs.filter((pair) => pair.sourcePath === '/src/bar.ts' && pair.cognitionPath === '/cog/bar.md').length,
			1,
		);
	});

	test('computes correct stats', () => {
		const result = calculateAffected(['/src/foo.ts'], mapping);
		assert.strictEqual(
			result.stats.direct + result.stats.structural + result.stats.semantic,
			result.stats.total,
		);
		assert.strictEqual(result.stats.semantic, 0);
	});
});
