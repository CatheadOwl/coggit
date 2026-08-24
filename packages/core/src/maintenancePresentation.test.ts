import * as assert from 'node:assert';

import type { MaintenanceDiagnostic } from './types';
import {
	projectMaintenancePresentation,
	renderMaintenancePresentation,
} from './maintenancePresentation';

function uri(path: string) {
	return { scheme: 'file', authority: '', path, query: '', fragment: '' };
}

function diagnostics(): MaintenanceDiagnostic[] {
	return [
		{
			kind: 'orphaned',
			entry: {
				registryKey: 'watch/',
				type: 'folder',
				sourcePath: 'src/watch',
				sourceUri: uri('/workspace/src/watch'),
				cognitionPath: 'cognition/watch/README.md',
				cognitionUri: uri('/workspace/cognition/watch/README.md'),
			},
		},
		{
			kind: 'misplaced',
			entry: {
				registryKey: 'old/foo.ts',
				type: 'leaf',
				sourcePath: 'src/new/foo.ts',
				sourceUri: uri('/workspace/src/new/foo.ts'),
				actualCognitionPath: 'cognition/old/foo.ts.md',
				actualCognitionUri: uri('/workspace/cognition/old/foo.ts.md'),
				expectedCognitionPath: 'cognition/new/foo.ts.md',
				expectedCognitionUri: uri('/workspace/cognition/new/foo.ts.md'),
			},
		},
		{
			kind: 'stray',
			entry: {
				registryKey: 'fresh/bar.ts',
				type: 'leaf',
				cognitionPath: 'cognition/fresh/bar.ts.md',
				cognitionUri: uri('/workspace/cognition/fresh/bar.ts.md'),
				sourceCandidateUris: [uri('/workspace/src/fresh/bar.ts')],
				sourceCandidateState: 'unchecked',
			},
		},
		{
			kind: 'unbound',
			entry: {
				registryKey: 'moved/baz.ts',
				type: 'leaf',
				cognitionPath: 'cognition/moved/baz.ts.md',
				cognitionUri: uri('/workspace/cognition/moved/baz.ts.md'),
				sourceCandidateUris: [uri('/workspace/src/moved/baz.ts')],
				sourceCandidateState: 'some-exist',
			},
		},
		{
			kind: 'unbound',
			entry: {
				registryKey: 'gone/qux.ts',
				type: 'leaf',
				cognitionPath: 'cognition/gone/qux.ts.md',
				cognitionUri: uri('/workspace/cognition/gone/qux.ts.md'),
				sourceCandidateUris: [uri('/workspace/src/gone/qux.ts')],
				sourceCandidateState: 'all-missing',
			},
		},
	];
}

suite('maintenance presentation', () => {
	test('maps every diagnostic kind to a distinct stable issue code', () => {
		const view = projectMaintenancePresentation(diagnostics());

		assert.deepStrictEqual(
			view.items.map((item) => item.issueCode),
			[
				'tracked-source-missing',
				'cognition-path-out-of-sync',
				'unregistered-cognition',
				'unbound-cognition',
				'missing-source-candidate',
			],
		);
		assert.ok(view.items.every((item) => item.severity === 'warning'));
	});

	test('keeps orphaned and missing-source candidate as distinct codes', () => {
		const view = projectMaintenancePresentation(diagnostics());

		const orphaned = view.items.find((item) => item.kind === 'orphaned');
		const candidate = view.items.find((item) => item.issueCode === 'missing-source-candidate');
		assert.notStrictEqual(orphaned?.issueCode, candidate?.issueCode);
		assert.strictEqual(orphaned?.message.includes('src/watch'), true);
	});

	test('renders text with stable codes and concise next hints', () => {
		const view = projectMaintenancePresentation(diagnostics());

		const text = renderMaintenancePresentation(view, 'text');
		assert.match(text, /^Maintenance issues: 5/);
		assert.match(text, /^- warning tracked-source-missing cognition\/watch\/README\.md: .*Restore the source/m);
		assert.match(text, /^- warning cognition-path-out-of-sync .*Move cognition to cognition\/new\/foo\.ts\./m);
		assert.match(text, /^- warning unbound-cognition .*not bound to a source/m);
		assert.match(text, /^- warning missing-source-candidate .*no likely source candidate/m);
	});

	test('renders markdown with bold labels and hard line breaks', () => {
		const view = projectMaintenancePresentation(diagnostics());

		const markdown = renderMaintenancePresentation(view, 'markdown');
		assert.match(markdown, /^\*\*Maintenance issues\*\*: 5/);
		assert.ok(markdown.includes('  \n'));
	});

	test('reports empty state when no diagnostics exist', () => {
		const view = projectMaintenancePresentation([]);

		assert.strictEqual(
			renderMaintenancePresentation(view),
			'No cognition maintenance issues found.',
		);
	});
});
