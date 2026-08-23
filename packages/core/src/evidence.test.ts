import * as assert from 'assert';

import {
	checkMtime,
	collectEvidence,
	deriveActions,
	deriveStaleDegree,
	isTemplateContent,
	synthesizeStatus,
} from './evidence';
import type { CognitionFileInfo, Evidence, ObservedStatus, Reason, SourceFileInfo } from './types';

suite('evidence template detection', () => {
	test('returns true for null content', () => {
		assert.strictEqual(isTemplateContent(null), true);
	});

	test('returns true for empty content', () => {
		assert.strictEqual(isTemplateContent(''), true);
	});

	test('returns true for just a title', () => {
		assert.strictEqual(isTemplateContent('# My Cognition'), true);
	});

	test('returns true for title and blank lines', () => {
		assert.strictEqual(isTemplateContent('# Title\n\n\n'), true);
	});

	test('returns true for title and short description', () => {
		assert.strictEqual(isTemplateContent('# Title\nTODO'), true);
	});

	test('returns false for content with substantial body', () => {
		const content = `# Module X\n\nThis module handles the core logic.\n\n## Usage\n\nCall \`doSomething()\` to start.`;
		assert.strictEqual(isTemplateContent(content), false);
	});

	test('returns true for only headings', () => {
		assert.strictEqual(isTemplateContent('# Title\n## Section 1\n## Section 2'), true);
	});
});

suite('evidence collection', () => {
	const source: SourceFileInfo = {
		uri: 'file:///src/foo.ts',
		mtimeMs: 2000,
		content: 'const x = 1;',
		blobHash: 'abc',
		publicSymbols: ['x'],
		dependencies: [],
	};

	test('collects evidence when cognition is null', () => {
		const evidence = collectEvidence(source, null);
		assert.strictEqual(evidence.cognitionMtimeMs, null);
		assert.strictEqual(evidence.sourceMtimeMs, 2000);
		assert.strictEqual(evidence.sourceChangedSinceAccepted, false);
		assert.strictEqual(evidence.sourceDeleted, false);
		assert.deepStrictEqual(evidence.sourceMetrics, {
			charLength: 12,
			lineCount: 1,
			nonEmptyLineCount: 1,
		});
		assert.strictEqual(evidence.cognitionMetrics, null);
		assert.deepStrictEqual(evidence.changeMetrics, {
			basis: 'unavailable',
			changedLines: null,
			changeRatio: null,
		});
	});

	test('collects multiline text metrics without treating blank lines as content', () => {
		const cognition: CognitionFileInfo = {
			uri: 'file:///cog/foo.md',
			mtimeMs: 1000,
			content: '# Foo\n\nNotes\n',
			links: [],
			brokenLinks: [],
		};

		const evidence = collectEvidence({
			...source,
			content: 'const x = 1;\n\nconst y = 2;\n',
		}, cognition);

		assert.deepStrictEqual(evidence.sourceMetrics, {
			charLength: 27,
			lineCount: 4,
			nonEmptyLineCount: 2,
		});
		assert.deepStrictEqual(evidence.cognitionMetrics, {
			charLength: 13,
			lineCount: 4,
			nonEmptyLineCount: 2,
		});
	});

	test('detects template cognition content', () => {
		const evidence = collectEvidence(source, cognition('# Foo'));
		assert.strictEqual(evidence.cognitionContentIsTemplate, true);
	});

	test('detects non-template cognition content', () => {
		const evidence = collectEvidence(source, cognition(
			'# Foo\n\nThis is a detailed analysis of the foo module.\n\n## API\n\n- doSomething() does X\n- doMore() does Y',
		));
		assert.strictEqual(evidence.cognitionContentIsTemplate, false);
	});

	test('detects source changed since verification', () => {
		const evidence = collectEvidence(source, {
			...cognition('# Foo'),
			verificationTimeMs: 1000,
		});
		assert.strictEqual(evidence.sourceChangedSinceAccepted, true);
	});
});

suite('state synthesis', () => {
	test('untracked when cognition mtime is null', () => {
		const result = synthesizeStatus([], makeEvidence({ cognitionMtimeMs: null }));
		assert.strictEqual(result.observedStatus, undefined);
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'missing-cognition'));
		assert.deepStrictEqual(result.issues[0].actions.map((action) => action.label), ['Create cognition file']);
	});

	test('orphaned when sourceDeleted is true', () => {
		const result = synthesizeStatus([], makeEvidence({ sourceDeleted: true, cognitionMtimeMs: 500 }));
		assert.strictEqual(result.observedStatus, 'stale');
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'source-deleted'));
	});

	test('broken when errors exist', () => {
		const reasons: Reason[] = [{ kind: 'corrupted-metadata', severity: 'error', message: 'bad' }];
		const result = synthesizeStatus(reasons, makeEvidence());
		assert.strictEqual(result.observedStatus, 'conflict');
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'metadata-broken'));
	});

	test('stale when source changed and warnings exist', () => {
		const reasons: Reason[] = [{ kind: 'outdated-mtime', severity: 'warning', message: 'warn' }];
		const result = synthesizeStatus(reasons, makeEvidence({ sourceChangedSinceAccepted: true }));
		assert.strictEqual(result.observedStatus, 'fresh');
	});

	test('partial when broken links exist', () => {
		const reasons: Reason[] = [{ kind: 'broken-links', severity: 'warning', message: 'missing' }];
		const result = synthesizeStatus(reasons, makeEvidence());
		assert.strictEqual(result.observedStatus, 'stale');
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'broken-links'));
	});

	test('stale when source changed since accepted', () => {
		const reasons: Reason[] = [{ kind: 'outdated-mtime', severity: 'warning', message: 'old' }];
		const result = synthesizeStatus(reasons, makeEvidence({ sourceChangedSinceAccepted: true }));
		assert.strictEqual(result.observedStatus, 'fresh');
	});

	test('stale when symbol-changed reason', () => {
		const reasons: Reason[] = [{ kind: 'symbol-changed', severity: 'warning', message: 'new' }];
		const result = synthesizeStatus(reasons, makeEvidence());
		assert.strictEqual(result.observedStatus, 'stale');
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'outdated-cognition'));
	});

	test('stale when outdated-mtime reason', () => {
		const reasons: Reason[] = [{ kind: 'outdated-mtime', severity: 'warning', message: 'old' }];
		const result = synthesizeStatus(reasons, makeEvidence());
		assert.strictEqual(result.observedStatus, 'fresh');
	});

	test('current source fact identity supersedes outdated mtime', () => {
		const reasons: Reason[] = [{ kind: 'outdated-mtime', severity: 'warning', message: 'old' }];
		const result = synthesizeStatus(reasons, makeEvidence({
			sourceFactIdentity: {
				kind: 'file-content',
				currentHash: 'abc',
			},
			sourceChangedSinceAccepted: false,
		}));

		assert.strictEqual(result.observedStatus, 'fresh');
		assert.deepStrictEqual(result.issues, []);
	});

	test('folder outdated-mtime reason uses folder-specific issue', () => {
		const reasons: Reason[] = [{ kind: 'outdated-mtime', severity: 'warning', message: 'old' }];
		const result = synthesizeStatus(reasons, makeEvidence({
			sourceFactIdentity: {
				kind: 'directory-entry',
				currentHash: 'abc',
			},
		}));

		assert.strictEqual(result.observedStatus, 'fresh');
	});

	test('template when cognition is skeleton', () => {
		const result = synthesizeStatus([], makeEvidence({ cognitionContentIsTemplate: true }));
		assert.strictEqual(result.observedStatus, 'stale');
		assert.ok(result.issues.some((issue) => issue.diagnostic.code === 'template-cognition'));
	});

	test('fresh when no issues', () => {
		const result = synthesizeStatus([], makeEvidence());
		assert.strictEqual(result.observedStatus, 'fresh');
		assert.strictEqual(result.issues.length, 0);
	});

	test('fresh with info-only reasons', () => {
		const reasons: Reason[] = [{ kind: 'dep-mismatch', severity: 'info', message: 'info' }];
		const result = synthesizeStatus(reasons, makeEvidence());
		assert.strictEqual(result.observedStatus, 'fresh');
		assert.strictEqual(result.issues.length, 0);
	});
});

suite('derive actions', () => {
	const templateSynth = { observedStatus: 'stale' as ObservedStatus, issues: [{ diagnostic: { code: 'template-cognition' as const, severity: 'info' as const, message: 'Cognition file exists but still looks like a template.' }, actions: [{ label: 'Fill in cognition content' }] }], coverage: { ownCognition: 'present' as const, isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 } };
	const staleSynth = { observedStatus: 'stale' as ObservedStatus, issues: [{ diagnostic: { code: 'outdated-cognition' as const, severity: 'warning' as const, message: 'Stale cognition.' }, actions: [{ label: 'Sync cognition with source changes' }] }], coverage: { ownCognition: 'present' as const, isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 } };
	const freshSynth = { observedStatus: 'fresh' as ObservedStatus, issues: [], coverage: { ownCognition: 'present' as const, isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 } };
	const conflictSynth = { observedStatus: 'conflict' as ObservedStatus, issues: [{ diagnostic: { code: 'conflicting-evidence' as const, severity: 'error' as const, message: 'Multiple evidence dimensions disagree about node status.' }, actions: [{ label: 'Review evidence and manually resolve conflict' }] }], coverage: { ownCognition: 'present' as const, isMaterializable: false, missingMaterializableCount: 0, coveredCount: 1 } };
	const orphanSynth = { observedStatus: 'stale' as ObservedStatus, issues: [{ diagnostic: { code: 'source-deleted' as const, severity: 'error' as const, message: 'Cognition exists but the paired source appears deleted.' }, actions: [{ label: 'Remove orphaned cognition file or restore source' }] }], coverage: { ownCognition: 'not-applicable' as const, isMaterializable: false, missingMaterializableCount: 0, coveredCount: 0 } };

	test('returns create action for missing cognition', () => {
		assert.deepStrictEqual(deriveActions({ observedStatus: undefined, issues: [{ diagnostic: { code: 'missing-cognition', severity: 'info', message: 'Source file has no paired cognition file.' }, actions: [{ label: 'Create cognition file' }] }], coverage: { ownCognition: 'missing', isMaterializable: true, missingMaterializableCount: 1, coveredCount: 0 } }, []), ['Create cognition file']);
	});

	test('returns fill for template', () => {
		assert.deepStrictEqual(deriveActions(templateSynth, []), ['Fill in cognition content']);
	});

	test('returns sync for stale', () => {
		assert.deepStrictEqual(deriveActions(staleSynth, []), ['Sync cognition with source changes']);
	});

	test('returns empty for fresh', () => {
		assert.deepStrictEqual(deriveActions(freshSynth, []), []);
	});

	test('returns actionable for conflicted', () => {
		assert.deepStrictEqual(deriveActions(conflictSynth, []), ['Review evidence and manually resolve conflict']);
	});

	test('returns actionable for orphaned', () => {
		assert.deepStrictEqual(deriveActions(orphanSynth, []), ['Remove orphaned cognition file or restore source']);
	});
});

suite('stale degree derivation', () => {
	test('returns a zero score for unchanged source evidence', () => {
		const result = deriveStaleDegree(makeVerifiedEvidence());

		assert.strictEqual(result.availability, 'available');
		assert.strictEqual(result.score, 0);
		assert.strictEqual(result.recommendation, 'none');
		assert.strictEqual(result.confidence, 'high');
	});

	test('returns low-confidence optional baseline when changed-line evidence is unavailable', () => {
		const result = deriveStaleDegree(makeVerifiedEvidence({
			sourceFactIdentity: {
				kind: 'file-content',
				currentHash: 'abc',
			},
			sourceChangedSinceAccepted: true,
		}));

		assert.strictEqual(result.availability, 'available');
		assert.strictEqual(result.score, 0.35);
		assert.strictEqual(result.recommendation, 'optional');
		assert.strictEqual(result.confidence, 'low');
		assert.match(result.reason, /changed-line evidence is unavailable/);
	});

	test('does not derive stale degree for missing cognition or deleted source evidence', () => {
		assert.strictEqual(
			deriveStaleDegree(makeVerifiedEvidence({ cognitionMtimeMs: null })).availability,
			'not-applicable',
		);
		assert.strictEqual(
			deriveStaleDegree(makeVerifiedEvidence({ sourceDeleted: true })).availability,
			'not-applicable',
		);
	});

	test('does not derive stale degree when evidence hashes are inconsistent', () => {
		const result = deriveStaleDegree(makeVerifiedEvidence({
			sourceFactIdentity: {
				kind: 'file-content',
				currentHash: 'unexpected',
			},
			sourceChangedSinceAccepted: true,
		}));

		assert.strictEqual(result.availability, 'unavailable');
		assert.strictEqual(result.score, null);
		assert.strictEqual(result.recommendation, null);
		assert.strictEqual(result.confidence, 'none');
	});

	test('maps explicit change ratios to maintenance recommendations', () => {
		const changed = {
			sourceFactIdentity: {
				kind: 'file-content' as const,
				currentHash: 'abc',
			},
			sourceChangedSinceAccepted: true,
		};

		assert.strictEqual(deriveStaleDegree(makeVerifiedEvidence({
			...changed,
			changeMetrics: { basis: 'git-diff', changedLines: 1, changeRatio: 0.1 },
		})).recommendation, 'optional');
		assert.strictEqual(deriveStaleDegree(makeVerifiedEvidence({
			...changed,
			changeMetrics: { basis: 'git-diff', changedLines: 10, changeRatio: 0.3 },
		})).recommendation, 'recommended');
		assert.strictEqual(deriveStaleDegree(makeVerifiedEvidence({
			...changed,
			changeMetrics: { basis: 'snapshot', changedLines: 40, changeRatio: 0.7 },
		})).recommendation, 'urgent');
	});
});

suite('evidence check functions', () => {
	const source: SourceFileInfo = {
		uri: 'file:///src/foo.ts',
		mtimeMs: 2000,
		content: 'let x = 1;',
		blobHash: 'abc',
		publicSymbols: [],
		dependencies: [],
	};

	test('checkMtime returns reason when source mtime is newer than cognition mtime', () => {
		const reasons = checkMtime(source, cognition('# Foo', 1000));
		assert.strictEqual(reasons.length, 1);
		assert.strictEqual(reasons[0].kind, 'outdated-mtime');
	});

	test('checkMtime returns empty when cognition mtime is not older', () => {
		assert.strictEqual(checkMtime(source, cognition('# Foo', 3000)).length, 0);
	});

	test('checkMtime returns empty when cognition is null', () => {
		assert.strictEqual(checkMtime(source, null).length, 0);
	});

});

function cognition(content: string, mtimeMs = 1000): CognitionFileInfo {
	return {
		uri: 'file:///cog/foo.md',
		mtimeMs,
		content,
		links: [],
		brokenLinks: [],
	};
}

function makeEvidence(overrides: Partial<Evidence> = {}): Evidence {
	return {
		sourceMtimeMs: 1000,
		sourceBlobHash: 'abc',
		cognitionMtimeMs: 500,
		sourceFactIdentity: {
			kind: 'file-content',
			currentHash: 'abc',
		},
		sourceChangedSinceAccepted: false,
		sourceMetrics: {
			charLength: 12,
			lineCount: 1,
			nonEmptyLineCount: 1,
		},
		cognitionMetrics: {
			charLength: 20,
			lineCount: 3,
			nonEmptyLineCount: 2,
		},
		changeMetrics: {
			basis: 'unavailable',
			changedLines: null,
			changeRatio: null,
		},
		changedSymbols: [],
		brokenLinks: [],
		gitCommitsSinceVerified: 0,
		cognitionContentIsTemplate: false,
		sourceDeleted: false,
		...overrides,
	};
}

function makeVerifiedEvidence(overrides: Partial<Evidence> = {}): Evidence {
	return makeEvidence({
		sourceFactIdentity: {
			kind: 'file-content',
			currentHash: 'abc',
		},
		sourceChangedSinceAccepted: false,
		...overrides,
	});
}
