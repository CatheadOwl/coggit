import * as assert from 'assert';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { __testing__ as statusTesting, collectSubtreeIssues, countSubtreeIssues, computeRuntimeStatus, projectStatusResultToNodeStatus, querySubtreeIssues } from '../core/status';
import { clipboardText, tooltipText } from '../format/nodeFormat.js';
import { snapshotTreeText } from '../format/snapshotFormat.js';
import { nodeClipboardStatusText, nodeTooltip } from '../format/nodePresentation.js';
import { renderNodeStatusInspectionText } from '../render/status.js';
import { CoggitTreeDataProvider } from '../runtime/vscode/tree/coggitTreeDataProvider';
import { __testing__ as gitignoreTesting } from '../core/gitignore';
import { getParentDir, getProjectRootPath, inferSourceUriCandidatesFromCognitionUri, normalizeSourcePathInput, resolveConfigRoots, toCognitionFilePath, toCognitionFileUri, toCognitionFolderReadmePath, toCognitionFolderReadmeUri } from '../core/mapping';
import { toCoggitResourceUri, fromCoggitResourceUri } from '../runtime/vscode/adapter/resourceMapper';
import { formatUri, fromComponents, isEqualOrChildUri, joinUriPath, uriBasename, uriKey, uriRelativePath } from '../runtime/vscode/adapter/uri';
import type { CoggitSnapshot, CoggitTreeNode, CoggitWorkspaceRoot, EvidenceDiagnostic, NodeStatusResult, StatusContext } from '../core/types';
import type { UriComponents } from '../core/interfaces';

suite('CogGit Ghost Tree', () => {
	function mkTestUri(path: string): UriComponents {
		return { scheme: 'file', authority: '', path, query: '', fragment: '' };
	}

	function mkStatusNode(
		id: string,
		relativePath: string,
		ownStatus?: NodeStatusResult,
		parent?: CoggitTreeNode,
	): CoggitTreeNode {
		const root: CoggitWorkspaceRoot = parent?.root ?? {
			id: 'test-root',
			label: 'test',
			workspaceFolder: { uri: mkTestUri('/workspace'), name: 'workspace', index: 0 },
			configUri: mkTestUri('/workspace/.coggit/config.yaml'),
			projectRootUri: mkTestUri('/workspace'),
			sourceRootUri: mkTestUri('/workspace/src'),
			cognitionRootUri: mkTestUri('/workspace/cog'),
		};
		const sourceUri = relativePath === '.'
			? root.sourceRootUri
			: mkTestUri(`/workspace/src/${relativePath.replace(/^src\//, '')}`);
		return {
			id,
			kind: parent ? 'file' : 'root',
			label: id,
			resourceUri: sourceUri,
			sourceUri,
			relativePath,
			ownStatus,
			status: ownStatus,
			contextValue: 'test',
			parent,
			root,
		};
	}


	// ─── Phase 1: Path Mapping ─────────────────────────────────────────────────

	test('maps source file to cognition markdown path', () => {
		const sourceRoot = vscode.Uri.file('/workspace/src');
		const cognitionRoot = vscode.Uri.file('/workspace/src_cog');
		const sourceFile = vscode.Uri.file('/workspace/src/foo/bar.ts');

		const cognitionFile = toCognitionFilePath(sourceRoot.fsPath, cognitionRoot.fsPath, sourceFile.fsPath);

		// Compare POSIX path component (cross-platform safe)
		assert.strictEqual(
			vscode.Uri.file(cognitionFile).path,
			'/workspace/src_cog/foo/bar.ts.md',
		);
	});

	test('preserves URI scheme and authority in runtime mapping APIs', () => {
		const configUri = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/.coggit/config.yaml');
		const roots = resolveConfigRoots(configUri, {
			sourceRoot: 'src',
			cognitionRoot: 'src_cog',
		});
		const sourceFile = vscode.Uri.joinPath(fromComponents(roots.sourceRootUri), 'foo', 'bar.test.ts');

		const cognitionFile = toCognitionFileUri(
			roots.sourceRootUri,
			roots.cognitionRootUri,
			sourceFile,
		);
		const folderReadme = toCognitionFolderReadmeUri(
			roots.sourceRootUri,
			roots.cognitionRootUri,
			vscode.Uri.joinPath(fromComponents(roots.sourceRootUri), 'foo'),
		);

		assert.strictEqual(fromComponents(roots.projectRootUri).toString(), 'vscode-remote://ssh-remote%2Bbox/workspace/project');
		assert.strictEqual(fromComponents(cognitionFile).toString(), 'vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog/foo/bar.test.ts.md');
		assert.strictEqual(fromComponents(folderReadme).toString(), 'vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog/foo/README.md');
	});

	test('normalizes sourcePath input against the configured source root', () => {
		const configUri = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/.coggit/config.yaml');
		const roots = resolveConfigRoots(configUri, {
			sourceRoot: 'codebase',
			cognitionRoot: 'codebase_cognition',
		});

		assert.strictEqual(
			normalizeSourcePathInput('codebase/coggit/src/core', {
				projectRootUri: roots.projectRootUri,
				sourceRootUri: roots.sourceRootUri,
			}),
			'coggit/src/core',
		);
		assert.strictEqual(
			normalizeSourcePathInput('\\codebase\\coggit\\', { sourceRoot: 'codebase' }),
			'coggit',
		);
		assert.strictEqual(normalizeSourcePathInput('coggit/src/core', { sourceRoot: 'codebase' }), 'coggit/src/core');
		assert.strictEqual(normalizeSourcePathInput('codebase', { sourceRoot: 'codebase' }), '.');
	});

	// ─── Phase 1: URI foundation ───────────────────────────────────────────

	test('normalizes URI identity through a single key helper', () => {
		const remoteRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project');
		const joined = joinUriPath(remoteRoot, 'src', 'foo.ts');
		const parsed = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo.ts');
		const samePathFile = vscode.Uri.parse('file:///workspace/project/src/foo.ts');
		const otherAuthority = vscode.Uri.parse('vscode-remote://ssh-remote%2Bother/workspace/project/src/foo.ts');

		assert.strictEqual(uriKey(joined), uriKey(parsed));
		assert.notStrictEqual(uriKey(joined), uriKey(samePathFile));
		assert.notStrictEqual(uriKey(joined), uriKey(otherAuthority));
	});

	test('computes URI relative paths without fsPath fallback', () => {
		const root = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/');
		const child = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo/bar.ts');
		const sibling = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src-other/foo.ts');
		const customRoot = vscode.Uri.parse('memfs:/workspace/project/src');
		const customChild = vscode.Uri.parse('memfs:/workspace/project/src/foo.ts');

		assert.strictEqual(uriRelativePath(root, root), '.');
		assert.strictEqual(uriRelativePath(root, child), 'foo/bar.ts');
		assert.strictEqual(uriRelativePath(root, sibling), undefined);
		assert.strictEqual(uriRelativePath(root, vscode.Uri.parse('file:///workspace/project/src/foo.ts')), undefined);
		assert.strictEqual(uriRelativePath(customRoot, customChild), 'foo.ts');
	});

	test('checks URI containment by scheme, authority, and path', () => {
		const root = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src');

		assert.strictEqual(isEqualOrChildUri(root, root), true);
		assert.strictEqual(isEqualOrChildUri(root, vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo.ts')), true);
		assert.strictEqual(isEqualOrChildUri(root, vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src-other/foo.ts')), false);
		assert.strictEqual(isEqualOrChildUri(root, vscode.Uri.parse('vscode-remote://ssh-remote%2Bother/workspace/project/src/foo.ts')), false);
	});

	test('formats remote URI display values without assuming fsPath', () => {
		const remote = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo.ts');
		const custom = vscode.Uri.parse('memfs:/workspace/project/src/bar.ts');

		assert.strictEqual(uriBasename(remote), 'foo.ts');
		assert.strictEqual(uriBasename(custom), 'bar.ts');
		assert.strictEqual(formatUri(remote), remote.toString());
	});

	test('round-trips Coggit resource URIs without losing original scheme', () => {
		const remote = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo.ts');
		const custom = vscode.Uri.parse('memfs:/workspace/project/src/bar.ts');

		assert.strictEqual(fromCoggitResourceUri(toCoggitResourceUri(remote)).toString(), remote.toString());
		assert.strictEqual(fromCoggitResourceUri(toCoggitResourceUri(custom)).toString(), custom.toString());
	});


	// ─── Phase 1: gitignore ────────────────────────────────────────────────

	test('reuses gitignore rules for dependency folders', () => {
		const rules = gitignoreTesting.parseGitignoreRules('node_modules/\ndist/\n*.log\n');

		assert.strictEqual(gitignoreTesting.matchesRule(rules[0], 'node_modules', true), true);
		assert.strictEqual(gitignoreTesting.matchesRule(rules[0], 'node_modules/pkg/index.js', false), true);
		assert.strictEqual(gitignoreTesting.matchesRule(rules[0], 'src/node_modules/pkg/index.js', false), true);
		assert.strictEqual(gitignoreTesting.matchesRule(rules[2], 'src/debug.log', false), true);
		assert.strictEqual(gitignoreTesting.matchesRule(rules[0], 'src/app.ts', false), false);
	});

	test('layers nested gitignore rules from their own folder', () => {
		const root = vscode.Uri.file('/workspace/project');
		const rootRules = gitignoreTesting.parseGitignoreRules('dist/\n');
		const nestedRules = gitignoreTesting.parseGitignoreRules('node_modules/\n', 'packages/app');
		const ruleSet = { rules: [...rootRules, ...nestedRules] };

		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(root, ruleSet, vscode.Uri.file('/workspace/project/dist/app.js'), false), true);
		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(root, ruleSet, vscode.Uri.file('/workspace/project/packages/app/node_modules/pkg/index.js'), false), true);
		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(root, ruleSet, vscode.Uri.file('/workspace/project/node_modules/pkg/index.js'), false), false);
	});

	test('matches gitignore rules for remote and custom URI schemes', () => {
		const remoteRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project');
		const remoteRules = gitignoreTesting.parseGitignoreRules('dist/\n*.log\n');
		const remoteRuleSet = { rules: remoteRules };
		const customRoot = vscode.Uri.parse('memfs:/workspace/project');
		const customRules = gitignoreTesting.parseGitignoreRules('cache/\n');
		const customRuleSet = { rules: customRules };

		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(remoteRoot, remoteRuleSet, joinUriPath(remoteRoot, 'dist', 'app.js'), false), true);
		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(remoteRoot, remoteRuleSet, joinUriPath(remoteRoot, 'src', 'debug.log'), false), true);
		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(remoteRoot, remoteRuleSet, vscode.Uri.parse('vscode-remote://ssh-remote%2Bother/workspace/project/dist/app.js'), false), false);
		assert.strictEqual(gitignoreTesting.isIgnoredByGitignoreRules(customRoot, customRuleSet, joinUriPath(customRoot, 'cache', 'data.json'), false), true);
	});

	// ─── Phase 1: Path (Supplementary) ─────────────────────────────────────────────

	test('maps source folder to cognition README path', () => {
		const sourceRoot = vscode.Uri.file('/workspace/src');
		const cognitionRoot = vscode.Uri.file('/workspace/src_cog');
		const sourceFolder = vscode.Uri.file('/workspace/src/foo');

		const readmeFile = toCognitionFolderReadmePath(sourceRoot.fsPath, cognitionRoot.fsPath, sourceFolder.fsPath);

		assert.strictEqual(
			vscode.Uri.file(readmeFile).path,
			'/workspace/src_cog/foo/README.md',
		);
	});

	test('infers source URI candidates without losing scheme or authority', () => {
		const sourceRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src');
		const cognitionRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog');
		const cognitionFile = vscode.Uri.joinPath(cognitionRoot, 'foo', 'bar.ts.md');

		const candidates = inferSourceUriCandidatesFromCognitionUri(cognitionFile, sourceRoot, cognitionRoot);

		assert.deepStrictEqual(
			candidates.map((uri) => fromComponents(uri).toString()),
			['vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo/bar.ts'],
		);
	});

	test('infers README cognition as source folder candidate', () => {
		const sourceRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src');
		const cognitionRoot = vscode.Uri.parse('vscode-remote://ssh-remote%2Bbox/workspace/project/src_cog');
		const cognitionReadme = vscode.Uri.joinPath(cognitionRoot, 'foo', 'README.md');

		const candidates = inferSourceUriCandidatesFromCognitionUri(cognitionReadme, sourceRoot, cognitionRoot);

		assert.deepStrictEqual(
			candidates.map((uri) => fromComponents(uri).toString()),
			['vscode-remote://ssh-remote%2Bbox/workspace/project/src/foo'],
		);
	});

		test('resolves config parent directory correctly', () => {
			const configUri = vscode.Uri.file('/workspace/project/.coggit/config.yaml');
			assert.strictEqual(
				vscode.Uri.file(getProjectRootPath(configUri.fsPath)).path,
				'/workspace/project',
			);
			assert.strictEqual(
				getParentDir('/workspace/project/src_cog/foo.md').replace(/\\/g, '/'),
				'/workspace/project/src_cog',
			);
		});
	// ─── Phase 1: 3-State Freshness ───────────────────────────────────────────

	test('computes freshness states by mtime', () => {
		assert.strictEqual(statusTesting.computeMtimeObservedStatus(10, undefined), undefined);
		assert.strictEqual(statusTesting.computeMtimeObservedStatus(10, 10), 'fresh');
		assert.strictEqual(statusTesting.computeMtimeObservedStatus(10, 11), 'fresh');
		assert.strictEqual(statusTesting.computeMtimeObservedStatus(10, 9), 'stale');
	});

	test('summarizes folder freshness with stale dominating undefined and fresh', () => {
		assert.strictEqual(statusTesting.combineObservedStatus(['fresh', undefined]), 'fresh');
		assert.strictEqual(statusTesting.combineObservedStatus(['fresh', 'stale']), 'stale');
		assert.strictEqual(statusTesting.combineObservedStatus(['fresh']), 'fresh');
	});

	test('summarizes latest representative mtime', () => {
		assert.strictEqual(statusTesting.summarizeRepresentativeMtime([{ representativeMtimeMs: 2 }, { representativeMtimeMs: 5 }, {}] as never), 5);
		assert.strictEqual(statusTesting.summarizeRepresentativeMtime([{}] as never), undefined);
	});

	test('combines observed status by layered severity order', () => {
		assert.strictEqual(statusTesting.combineObservedStatus(['fresh', undefined]), 'fresh');
		assert.strictEqual(statusTesting.combineObservedStatus(['fresh', 'stale']), 'stale');
		assert.strictEqual(statusTesting.combineObservedStatus(['stale', 'conflict', 'fresh']), 'conflict');
		assert.strictEqual(statusTesting.combineObservedStatus([undefined]), undefined);
	});

			test('projects missing legacy freshness without observed status', () => {
			const projected: NodeStatusResult = {
				observedStatus: undefined,
				ownObservedStatus: undefined,
				issues: [{ diagnostic: { code: 'missing-cognition', severity: 'info', message: 'Source file has no paired cognition file.' }, actions: [{ label: 'Create cognition file' }] }],
				coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
			};

			assert.strictEqual(projected.observedStatus, undefined);
			assert.strictEqual(projected.ownObservedStatus, undefined);
			assert.strictEqual(projected.coverage?.ownCognition, 'missing');
			assert.strictEqual(projected.coverage?.isMaterializable, true);
			assert.strictEqual(projected.coverage?.missingMaterializableCount, 1);
			assert.strictEqual(projected.issues?.some((issue) => issue.diagnostic.code === 'missing-cognition'), true);
		});

		test('projects status results into node status with coverage signals', () => {
			const status = computeRuntimeStatus({
				sourceUri: 'file:///src/foo.ts',
				sourceContent: 'export const foo = 1;',
				sourceMtimeMs: 20,
				cognitionUri: 'file:///cog/foo.ts.md',
				cognitionContent: '# Foo',
				cognitionMtimeMs: 10,
			});

			const projected: NodeStatusResult = {
				observedStatus: status.observedStatus,
				ownObservedStatus: status.ownObservedStatus,
				issues: status.issues,
				coverage: status.coverage,
				computedAt: status.computedAt,
			};

			assert.strictEqual(projected.observedStatus, 'stale');
			assert.strictEqual(projected.ownObservedStatus, 'stale');
			assert.strictEqual(projected.coverage?.ownCognition, 'present');
			assert.strictEqual(projected.coverage?.isMaterializable, false);
			assert.strictEqual(projected.coverage?.coveredCount, 1);
			assert.strictEqual(projected.issues, status.issues);
			assert.strictEqual(projected.computedAt, status.computedAt);
			assert.strictEqual(projected.issues?.some((issue) => issue.diagnostic.code === 'template-cognition'), true);
			assert.strictEqual('staleDegree' in projected, false);
		});

		test('projectStatusResultToNodeStatus keeps stale degree evidence out of node status', () => {
			const status = computeRuntimeStatus({
				sourceUri: 'file:///src/foo.ts',
				sourceContent: 'export const foo = 1;',
				sourceMtimeMs: 20,
				cognitionUri: 'file:///cog/foo.ts.md',
				cognitionContent: '# Foo\n\nUseful implementation notes.\nMore context.\n',
				cognitionMtimeMs: 10,
			});

			const projected = projectStatusResultToNodeStatus(status);

			assert.strictEqual('evidence' in projected, false);
			assert.strictEqual('staleDegree' in projected, false);
			assert.strictEqual(projected.observedStatus, status.observedStatus);
		});

		test('describes node status details for porcelain-style summaries', () => {
			const status: NodeStatusResult = {
				observedStatus: 'stale',
				issues: [
					{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] },
					{ diagnostic: { code: 'missing-coverage', severity: 'warning', message: 'Some source-level facts are not yet covered by cognition.' }, actions: [] },
				],
				coverage: {
					ownCognition: 'present',
					isMaterializable: false,
					missingMaterializableCount: 1,
					coveredCount: 2,
				},
			} as NodeStatusResult;
	
			const tooltip = tooltipText('/src.ts', '/cog.md', status);
			assert.match(tooltip, /\*\*Source\*\*.*\/src\.ts/);
			assert.match(tooltip, /\*\*Cognition\*\*.*\/cog\.md/);
			assert.match(tooltip, /\*\*Status\*\*.*Stale/);
			assert.match(tooltip, /→ Sync cognition/);
			assert.match(tooltip, /\[warning\].*Stale cognition/);
			assert.match(tooltip, /\[warning\].*not yet covered/);
			assert.match(tooltip, /→ Sync cognition/);
			assert.doesNotMatch(tooltip, /Own present/);
	
			const clip = clipboardText('/src.ts', '/cog.md', status);
			assert.match(clip, /Source: \/src\.ts/);
			assert.match(clip, /Cognition: \/cog\.md/);
			assert.match(clip, /Status: Stale/);
			assert.match(clip, /→ Sync cognition/);
			assert.doesNotMatch(clip, /\*\*/);
		});

		test('aggregateNodeStatus keeps own status while folding descendant status', () => {
			const ownStatus: NodeStatusResult = {
				observedStatus: undefined,
				ownObservedStatus: undefined,
				coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
			};
			const descendantStatus: NodeStatusResult = {
				observedStatus: 'stale',
				ownObservedStatus: 'stale',
				issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }],
				coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
			};

			const aggregated = statusTesting.aggregateNodeStatus({ ownStatus, descendantStatuses: [descendantStatus] });

			assert.strictEqual(aggregated.ownObservedStatus, undefined);
			assert.strictEqual(aggregated.descendantObservedStatus, 'stale');
			assert.strictEqual(aggregated.observedStatus, 'stale');
			assert.strictEqual(aggregated.coverage?.ownCognition, 'missing');
			assert.strictEqual(aggregated.coverage?.isMaterializable, true);
			assert.strictEqual(aggregated.coverage?.missingMaterializableCount, 1);
			assert.strictEqual(aggregated.coverage?.coveredCount, 1);
				assert.strictEqual(aggregated.issues, undefined);
		});

		test('aggregateNodeStatus does not retain stale descendant state from previous aggregate', () => {
			const ownStatus: NodeStatusResult = {
				observedStatus: undefined,
				ownObservedStatus: undefined,
				coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
			};
			const staleChildStatus: NodeStatusResult = {
				observedStatus: 'stale',
				ownObservedStatus: 'stale',
				issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }],
				coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
			};
			const freshChildStatus: NodeStatusResult = {
				observedStatus: 'fresh',
				ownObservedStatus: 'fresh',
				coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
			};
			const previousAggregate = statusTesting.aggregateNodeStatus({ ownStatus, descendantStatuses: [staleChildStatus] });

			const recomputedFromOwnStatus = statusTesting.aggregateNodeStatus({ ownStatus, descendantStatuses: [freshChildStatus] });
			const recomputedFromPreviousAggregate = statusTesting.aggregateNodeStatus({ ownStatus: previousAggregate, descendantStatuses: [freshChildStatus] });

			assert.strictEqual(recomputedFromOwnStatus.descendantObservedStatus, 'fresh');
			assert.strictEqual(recomputedFromOwnStatus.observedStatus, 'fresh');
			assert.strictEqual(recomputedFromOwnStatus.coverage?.coveredCount, 1);
			assert.strictEqual(recomputedFromPreviousAggregate.observedStatus, 'stale');
			assert.strictEqual(recomputedFromPreviousAggregate.coverage?.coveredCount, 2);
		});

			test('collectSubtreeIssues walks descendants while aggregate status keeps own issues only', () => {
				const root = mkStatusNode('root', '.', {
					observedStatus: 'stale',
					issues: [{ diagnostic: { code: 'missing-cognition', severity: 'info', message: 'Source file has no paired cognition file.' }, actions: [{ label: 'Create cognition file' }] }],
				});
				const folder = mkStatusNode('folder', 'src', undefined, root);
				const leafA = mkStatusNode('leaf-a', 'src/a.ts', {
					observedStatus: 'stale',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }],
				}, folder);
				const leafB = mkStatusNode('leaf-b', 'src/b.ts', {
					observedStatus: 'conflict',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }],
				}, root);
				folder.children = [leafA];
				root.children = [folder, leafB];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: root.children.map((child) => child.status),
				});

				const issues = collectSubtreeIssues(root);
				const query = querySubtreeIssues(root);

				assert.deepStrictEqual(issues.map((issue) => issue.relativePath), ['.', 'src/a.ts', 'src/b.ts']);
				assert.deepStrictEqual(issues.map((issue) => issue.issue.diagnostic.code), ['missing-cognition', 'outdated-cognition', 'outdated-cognition']);
				assert.deepStrictEqual(query.ownIssues.map((issue) => issue.relativePath), ['.']);
				assert.deepStrictEqual(query.descendantIssues.map((issue) => issue.relativePath), ['src/a.ts', 'src/b.ts']);
				assert.strictEqual(query.totalIssues, 3);
				assert.strictEqual(countSubtreeIssues(root), 3);
				assert.deepStrictEqual(root.status?.issues?.map((issue) => issue.diagnostic.code), ['missing-cognition']);
			});

			test('snapshotTreeText filters scoped nodes while retaining ancestor context', () => {
				const root = mkStatusNode('root', '.', {
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				});
				const tracked = mkStatusNode('tracked', 'tracked.ts', {
					observedStatus: 'fresh',
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, root);
				const folder = mkStatusNode('folder', 'src', {
					coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 1 },
				}, root);
				const untracked = mkStatusNode('untracked', 'src/missing.ts', {
					coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
				}, folder);
				folder.children = [untracked];
				root.children = [tracked, folder];
				const allNodes = [root, tracked, folder, untracked];
				const snapshot: CoggitSnapshot = {
					roots: [root],
					allNodes,
					nodeById: new Map(allNodes.map((node) => [node.id, node])),
					nodeBySourceUri: new Map(allNodes.map((node) => [node.sourceUri.path, node])),
				};

				const text = snapshotTreeText(snapshot, { scope: 'untracked' });

				assert.match(text, /^root \[Contains untracked\]/m);
				assert.match(text, /^  folder \[Contains untracked\]/m);
				assert.match(text, /^    untracked \[Untracked\]/m);
				assert.doesNotMatch(text, /tracked \[Fresh\]/);
			});

			test('snapshotTreeText defaults to tracked cognition nodes', () => {
				const root = mkStatusNode('root', '.', {
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				});
				const tracked = mkStatusNode('tracked', 'tracked.ts', {
					observedStatus: 'fresh',
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, root);
				const untracked = mkStatusNode('untracked', 'missing.ts', {
					coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
				}, root);
				root.children = [tracked, untracked];
				const allNodes = [root, tracked, untracked];
				const snapshot: CoggitSnapshot = {
					roots: [root],
					allNodes,
					nodeById: new Map(allNodes.map((node) => [node.id, node])),
					nodeBySourceUri: new Map(allNodes.map((node) => [node.sourceUri.path, node])),
				};

				const text = snapshotTreeText(snapshot);

				assert.match(text, /^root \[Unknown\]/m);
				assert.match(text, /^  tracked \[Fresh\]/m);
				assert.doesNotMatch(text, /untracked \[Untracked\]/);
			});

			test('snapshotTreeText keeps truncated ancestors when deeper descendants match tracked scope', () => {
				const root = mkStatusNode('root', '.', {
					coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
				});
				const folder = mkStatusNode('folder', 'folder', {
					coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
				}, root);
				const tracked = mkStatusNode('tracked', 'folder/tracked.ts', {
					observedStatus: 'fresh',
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, folder);
				folder.children = [tracked];
				folder.status = statusTesting.aggregateNodeStatus({
					ownStatus: folder.ownStatus,
					descendantStatuses: [tracked.status],
				});
				root.children = [folder];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: [folder.status],
				});
				const allNodes = [root, folder, tracked];
				const snapshot: CoggitSnapshot = {
					roots: [root],
					allNodes,
					nodeById: new Map(allNodes.map((node) => [node.id, node])),
					nodeBySourceUri: new Map(allNodes.map((node) => [node.sourceUri.path, node])),
				};

				const text = snapshotTreeText(snapshot, { scope: 'tracked', maxDepth: 0 });

				assert.match(text, /^root \[Fresh\]$/m);
				assert.doesNotMatch(text, /No tracked cognition nodes found/);
			});

			test('snapshotTreeText keeps truncated ancestors when deeper descendants match issues scope', () => {
				const root = mkStatusNode('root', '.', undefined);
				const folder = mkStatusNode('folder', 'folder', undefined, root);
				const stale = mkStatusNode('stale', 'folder/stale.ts', {
					observedStatus: 'stale',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }],
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, folder);
				folder.children = [stale];
				folder.status = statusTesting.aggregateNodeStatus({
					ownStatus: folder.ownStatus,
					descendantStatuses: [stale.status],
				});
				root.children = [folder];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: [folder.status],
				});
				const allNodes = [root, folder, stale];
				const snapshot: CoggitSnapshot = {
					roots: [root],
					allNodes,
					nodeById: new Map(allNodes.map((node) => [node.id, node])),
					nodeBySourceUri: new Map(allNodes.map((node) => [node.sourceUri.path, node])),
				};

				const text = snapshotTreeText(snapshot, { scope: 'issues', maxDepth: 1 });

				assert.match(text, /^root \[Contains issues\]/m);
				assert.match(text, /^  folder \[Contains issues\]$/m);
				assert.doesNotMatch(text, /No cognition maintenance issues found/);
				assert.doesNotMatch(text, /stale \[Stale\]/);
			});

			test('snapshotTreeText labels untracked matches by scope instead of aggregate status', () => {
				const root = mkStatusNode('root', '.', {
					coverage: { ownCognition: 'present', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 1 },
				});
				const untrackedFolder = mkStatusNode('folder', 'folder', {
					coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 },
				}, root);
				const staleTrackedChild = mkStatusNode('stale', 'folder/stale.ts', {
					observedStatus: 'stale',
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, untrackedFolder);
				untrackedFolder.children = [staleTrackedChild];
				untrackedFolder.status = statusTesting.aggregateNodeStatus({
					ownStatus: untrackedFolder.ownStatus,
					descendantStatuses: [staleTrackedChild.status],
				});
				root.children = [untrackedFolder];
				const allNodes = [root, untrackedFolder, staleTrackedChild];
				const snapshot: CoggitSnapshot = {
					roots: [root],
					allNodes,
					nodeById: new Map(allNodes.map((node) => [node.id, node])),
					nodeBySourceUri: new Map(allNodes.map((node) => [node.sourceUri.path, node])),
				};

				const text = snapshotTreeText(snapshot, { scope: 'untracked' });

				assert.match(text, /^root \[Contains untracked\]/m);
				assert.match(text, /^  folder \[Untracked\]/m);
				assert.doesNotMatch(text, /folder \[Stale\]/);
				assert.doesNotMatch(text, /stale \[Stale\]/);
			});

			test('clipboardNodeStatusText includes summary and located subtree diagnostics', () => {
				const root = mkStatusNode('root', 'src', {
					observedStatus: 'stale',
					ownObservedStatus: undefined,
				});
				const child = mkStatusNode('child', 'src/foo.ts', {
					observedStatus: 'stale',
					ownObservedStatus: 'stale',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }, { label: 'Other action' }] }],
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, root);
				root.children = [child];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: [child.status],
				});

				const text = nodeClipboardStatusText(root);

				assert.match(text, /^Status: Stale\nSource: src/);
				assert.doesNotMatch(text, /Own status:/);
				assert.match(text, /Own issues: 0/);
				assert.match(text, /Descendant issues: 1/);
				assert.match(text, /Status: Stale\nSource: src\n\nOwn issues: 0/);
				assert.match(text, /Own issues: 0\n\nDescendant issues: 1/);
				assert.doesNotMatch(text, /^→ /m);
				assert.doesNotMatch(text, /^This node:/m);
				assert.doesNotMatch(text, /^Descendants:/m);
				assert.match(text, /- src\/foo\.ts: \[warning\] Stale cognition/);
				assert.match(text, /Descendant issues: 1\n- src\/foo\.ts: \[warning\] Stale cognition/);
				assert.match(text, /Stale cognition.* Suggested actions: Sync cognition with source changes; Other action\./);
				assert.doesNotMatch(text, /\bAction:/);
				assert.doesNotMatch(text, /\*\*/);
			});

			test('nodeTooltip uses the same located issue wording as clipboard', () => {
				const root = mkStatusNode('root', 'src', {
					observedStatus: 'stale',
					ownObservedStatus: undefined,
				});
				const child = mkStatusNode('child', 'src/foo.ts', {
					observedStatus: 'stale',
					ownObservedStatus: 'stale',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }, { label: 'Other action' }] }],
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, root);
				root.children = [child];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: [child.status],
				});

				const text = nodeTooltip(root);

				assert.match(text, /^\*\*Status\*\*: Stale  \n\*\*Source\*\*: src/);
				assert.doesNotMatch(text, /\*\*Own status\*\*:/);
				assert.match(text, /\*\*Own issues\*\*: 0/);
				assert.match(text, /\*\*Descendant issues\*\*: 1/);
				assert.match(text, /\*\*Status\*\*: Stale  \n\*\*Source\*\*: src  \n  \n\*\*Own issues\*\*: 0/);
				assert.match(text, /\*\*Own issues\*\*: 0  \n  \n\*\*Descendant issues\*\*: 1/);
				assert.doesNotMatch(text, /^→ /m);
				assert.doesNotMatch(text, /\*\*This node\*\*:/);
				assert.doesNotMatch(text, /\*\*Descendants\*\*:/);
				assert.match(text, /\*\*Descendant issues\*\*: 1  \n- src\/foo\.ts: \[warning\] Stale cognition/);
				assert.match(text, /- src\/foo\.ts: \[warning\] Stale cognition.* Suggested actions: Sync cognition with source changes; Other action\./);
				assert.doesNotMatch(text, /\bAction:/);
			});

			test('CLI status rendering keeps suggested actions aligned with each issue', () => {
				const root = mkStatusNode('root', 'src', {
					observedStatus: 'stale',
					ownObservedStatus: undefined,
				});
				const child = mkStatusNode('child', 'src/foo.ts', {
					observedStatus: 'stale',
					ownObservedStatus: 'stale',
					issues: [{ diagnostic: { code: 'outdated-cognition', severity: 'warning', message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }, { label: 'Other action' }] }],
					coverage: { ownCognition: 'present', isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 },
				}, root);
				root.children = [child];
				root.status = statusTesting.aggregateNodeStatus({
					ownStatus: root.ownStatus,
					descendantStatuses: [child.status],
				});
				const inspection = statusTesting.inspectNodeStatus({
					node: root,
					sourcePath: root.relativePath,
					cognitionPath: null,
					handbookId: 'skeleton',
				});

				const text = renderNodeStatusInspectionText(inspection, 'aggregate');

				assert.match(text, /\nOwn issues: 0\n\nDescendant issues: 1\n- src\/foo\.ts: \[warning\] Stale cognition/);
				assert.match(text, /- src\/foo\.ts: \[warning\] Stale cognition\. Suggested actions: Sync cognition with source changes; Other action\./);
				assert.doesNotMatch(text, /\nIssues:\n/);
				assert.doesNotMatch(text, /\nSuggested actions:\n/);
			});


});
