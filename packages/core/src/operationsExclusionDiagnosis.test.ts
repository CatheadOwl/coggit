import * as assert from 'node:assert';
import * as fsReal from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import type { CoggitProject, SourcePathResolution, UriComponents } from './interfaces';
import type { CoggitWorkspaceRoot } from './types';
import { statusOperation } from './operations';
import { renderPathMissText } from './pathHints';

suite('status miss exclusion diagnosis (point-query probe consumption)', () => {
	function makeProject(srcDir: string): CoggitProject {
		const uri: UriComponents = {
			scheme: 'file',
			authority: '',
			path: srcDir.replace(/\\/g, '/'),
			query: '',
			fragment: '',
		};
		const root: CoggitWorkspaceRoot = {
			id: 'diag-project',
			label: 'diag',
			workspaceFolder: { uri, name: 'diag', index: 0 },
			configUri: uri,
			projectRootUri: uri,
			sourceRootUri: uri,
			cognitionRootUri: uri,
		};
		return {
			root,
			resolveSourcePath: async (candidate: string): Promise<SourcePathResolution> => ({
				node: undefined,
				candidatePaths: [],
				normalizedPath: candidate,
			}),
		} as unknown as CoggitProject;
	}

	test('a miss under a file-scheme source root carries the probe diagnosis', async () => {
		const tmp = fsReal.mkdtempSync(nodePath.join(os.tmpdir(), 'coggit-diag-'));
		try {
			const srcDir = nodePath.join(tmp, 'src');
			fsReal.mkdirSync(nodePath.join(srcDir, 'node_modules'), { recursive: true });
			fsReal.writeFileSync(nodePath.join(srcDir, 'node_modules', 'x.js'), '');

			const result = await statusOperation(
				[makeProject(srcDir)],
				nodePath.join(srcDir, 'node_modules', 'x.js'),
			);
			assert.strictEqual(result.found, false);
			assert.ok(result.exclusionDiagnosis, 'diagnosis present');
			assert.strictEqual(result.exclusionDiagnosis!.excluded, true);
			assert.strictEqual(result.exclusionDiagnosis!.projectId, 'diag-project');
			assert.ok(
				result.exclusionDiagnosis!.hits.some((h) => h.includes('deps preset')),
				`hits name the deps preset: ${JSON.stringify(result.exclusionDiagnosis!.hits)}`,
			);
			assert.strictEqual(result.exclusionDiagnosis!.pierceable, true);

			const text = renderPathMissText(result);
			assert.match(text, /Excluded from the scan scope of diag-project: yes/);
			assert.match(text, /hit: deps preset at node_modules/);
			assert.match(text, /un-exclude: rule-level only \(a named gitignore negation re-includes it\)/);
		} finally {
			fsReal.rmSync(tmp, { recursive: true, force: true });
		}
	});

	test('a path outside every project scope stays a plain miss (no diagnosis)', async () => {
		const tmp = fsReal.mkdtempSync(nodePath.join(os.tmpdir(), 'coggit-diag-'));
		try {
			const srcDir = nodePath.join(tmp, 'src');
			fsReal.mkdirSync(srcDir, { recursive: true });
			const elsewhere = nodePath.join(tmp, 'elsewhere', 'a.ts');

			const result = await statusOperation([makeProject(srcDir)], elsewhere);
			assert.strictEqual(result.found, false);
			assert.strictEqual(result.exclusionDiagnosis, null);
			const text = renderPathMissText(result);
			assert.doesNotMatch(text, /Excluded from the scan scope/);
		} finally {
			fsReal.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
