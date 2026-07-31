import * as assert from 'node:assert';

import { parseCognitionDocumentFacts } from './cognitionDocumentFacts';
import { computeBlobHash } from './hash';

function diagnosticCodes(content: string, path = 'src/example.ts.md'): string[] {
	return parseCognitionDocumentFacts(path, content).diagnostics.map((diagnostic) => diagnostic.code);
}

suite('cognitionDocumentFacts — parseCognitionDocumentFacts', () => {
	test('parses frontmatter, metadata, headings, metrics, and identity facts', () => {
		const content = [
			'---',
			'name: core-example',
			'description: Core example document',
			'metadata:',
			'  type: reference',
			'  layer: core',
			'  module: example',
			'  tags:',
			'    - status',
			'  apiSurface:',
			'    - parseCognitionDocumentFacts',
			'  retrieval:',
			'    summary: Route to document facts.',
			'    intents:',
			'      - metadata',
			'---',
			'',
			'# Example',
			'',
			'## Details',
		].join('\n');

		const facts = parseCognitionDocumentFacts('src/example.ts.md', content, { mtimeMs: 1234 });

		assert.strictEqual(facts.cognitionPath, 'src/example.ts.md');
		assert.strictEqual(facts.key, 'src/example.ts');
		assert.strictEqual(facts.kind, 'leaf');
		assert.strictEqual(facts.frontmatter.name, 'core-example');
		assert.strictEqual(facts.frontmatter.description, 'Core example document');
		assert.strictEqual(facts.frontmatter.metadata.type, 'reference');
		assert.strictEqual(facts.frontmatter.metadata.layer, 'core');
		assert.deepStrictEqual(facts.frontmatter.metadata.tags, ['status']);
		assert.deepStrictEqual(facts.frontmatter.metadata.apiSurface, ['parseCognitionDocumentFacts']);
		assert.deepStrictEqual(facts.frontmatter.metadata.retrieval?.intents, ['metadata']);
		assert.deepStrictEqual(
			facts.headings.map((heading) => [heading.depth, heading.text, heading.line, heading.slug]),
			[
				[1, 'Example', 18, 'example'],
				[2, 'Details', 20, 'details'],
			],
		);
		assert.strictEqual(facts.metrics.charLength, content.length);
		assert.strictEqual(facts.metrics.lineCount, 20);
		assert.strictEqual(facts.metrics.nonEmptyLineCount, 18);
		assert.strictEqual(facts.metrics.contentHash, computeBlobHash(content));
		assert.strictEqual(facts.metrics.mtimeMs, 1234);
		assert.deepStrictEqual(facts.diagnostics, []);
	});

	test('returns soft diagnostics for missing frontmatter and required routing fields', () => {
		const codes = diagnosticCodes('# No frontmatter');

		assert.deepStrictEqual(codes, [
			'missing-frontmatter',
			'missing-name',
			'missing-description',
			'missing-metadata-type',
		]);
	});

	test('returns malformed-frontmatter diagnostic for broken YAML', () => {
		const codes = diagnosticCodes([
			'---',
			'name: [broken',
			'---',
			'# Body',
		].join('\n'));

		assert.ok(codes.includes('malformed-frontmatter'));
		assert.ok(codes.includes('missing-name'));
		assert.ok(codes.includes('missing-description'));
		assert.ok(codes.includes('missing-metadata-type'));
	});

	test('returns diagnostics for missing required frontmatter fields', () => {
		const codes = diagnosticCodes([
			'---',
			'metadata:',
			'  layer: core',
			'---',
			'# Body',
		].join('\n'));

		assert.deepStrictEqual(codes, [
			'missing-name',
			'missing-description',
			'missing-metadata-type',
		]);
	});

	test('detects placeholder descriptions and invalid metadata shapes', () => {
		const codes = diagnosticCodes([
			'---',
			'name: placeholder-example',
			'description: <one-line role of this source file>',
			'metadata:',
			'  type: reference',
			'  tags: status',
			'  apiSurface: parse',
			'  retrieval:',
			'    intents: metadata',
			'---',
			'# Body',
		].join('\n'));

		assert.deepStrictEqual(codes, [
			'weak-description',
			'invalid-metadata-tags',
			'invalid-metadata-api-surface',
			'invalid-metadata-retrieval-intents',
		]);
	});

	test('extracts ATX headings while skipping fenced code blocks', () => {
		const content = [
			'---',
			'name: headings',
			'description: Heading extraction',
			'metadata:',
			'  type: reference',
			'---',
			'# Real Heading',
			'',
			'```ts',
			'# Not A Heading',
			'```',
			'',
			'~~~',
			'## Also Not A Heading',
			'~~~',
			'',
			'### Final Heading ###',
		].join('\n');

		const facts = parseCognitionDocumentFacts('src/headings.ts.md', content);

		assert.deepStrictEqual(
			facts.headings.map((heading) => [heading.depth, heading.text, heading.line, heading.slug]),
			[
				[1, 'Real Heading', 7, 'real-heading'],
				[3, 'Final Heading', 17, 'final-heading'],
			],
		);
	});

	test('derives folder kind for root and nested README cognition paths', () => {
		const root = parseCognitionDocumentFacts('README.md', '# Root');
		const nested = parseCognitionDocumentFacts('src/core/README.md', '# Core');

		assert.strictEqual(root.key, '/');
		assert.strictEqual(root.kind, 'folder');
		assert.strictEqual(nested.key, 'src/core/');
		assert.strictEqual(nested.kind, 'folder');
	});

	test('normalizes backslashes in cognitionPath output', () => {
		const facts = parseCognitionDocumentFacts('src\\core\\facts.ts.md', '# Body');

		assert.strictEqual(facts.cognitionPath, 'src/core/facts.ts.md');
		assert.strictEqual(facts.key, 'src/core/facts.ts');
		assert.strictEqual(facts.kind, 'leaf');
	});
});
