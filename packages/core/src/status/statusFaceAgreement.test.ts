import * as assert from 'node:assert';

import type {
  ConfigProvider,
  FileStat,
  FileSystem,
  UriComponents,
} from '../interfaces';
import type { CoggitWorkspaceRoot } from '../types';
import {
  buildSnapshotFromProjects,
  openCoggitProject,
  resolveNodeInSnapshot,
} from '../project';
import { statusOperation, type CoggitOperationIssue } from '../operations';
import { collectSubtreeIssues } from './index';

/**
 * Dual-face status agreement acceptance test (ISSUE 20260907-1800 item 2).
 *
 * `status/index.ts` is the funnel both status faces share: the VS Code
 * extension consumes snapshot objects (`CoggitTreeNode.status` /
 * `ownStatus`, produced by `buildSnapshotFromProjects`), while MCP/CLI
 * consume operation DTOs (`statusOperation` results projected through
 * `inspectNodeStatus`). Nothing in production forces the two faces to
 * agree — this test turns that convention into a mechanism.
 *
 * Method: one shared fixture builds one project and one snapshot; the
 * operation DTO is resolved against that same snapshot (the `snapshot`
 * option of `statusOperation`), so both faces describe the very same
 * node objects. The assertions pin the projection: the DTO's status
 * trio, stale action, issue counts, issue facts, and maintained-visibility
 * filter must all be derivable from the snapshot face's embedded facts
 * (`node.status`/`ownStatus` plus `collectSubtreeIssues`, the same
 * subtree collection the funnel itself uses).
 *
 * Zero behavior change is the contract: this file only observes. Any
 * disagreement it surfaces is a finding for the issue, not something to
 * fix here.
 */

interface MockFileEntry {
  isDirectory: boolean;
  content: string;
  mtimeMs: number;
}

class MockFileSystem implements FileSystem {
  private entries = new Map<string, MockFileEntry>();

  addDirectory(path: string, mtimeMs = 1000): void {
    this.entries.set(path, { isDirectory: true, content: '', mtimeMs });
  }

  addFile(path: string, content: string, mtimeMs = 1000): void {
    this.entries.set(path, { isDirectory: false, content, mtimeMs });
    const parts = path.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const dirPath = '/' + parts.slice(0, i).join('/');
      if (!this.entries.has(dirPath)) {
        this.addDirectory(dirPath, mtimeMs);
      }
    }
  }

  async readFile(uri: UriComponents): Promise<string> {
    const entry = this.entries.get(uri.path);
    if (!entry || entry.isDirectory) {
      throw new Error('ENOENT');
    }
    return entry.content;
  }

  async writeFile(uri: UriComponents, content: string): Promise<void> {
    this.addFile(uri.path, content);
  }

  async stat(uri: UriComponents): Promise<FileStat | undefined> {
    const entry = this.entries.get(uri.path);
    return entry
      ? { isDirectory: entry.isDirectory, mtimeMs: entry.mtimeMs }
      : undefined;
  }

  async readDirectory(uri: UriComponents): Promise<Array<[string, number]>> {
    const dirPath = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
    const children: Array<[string, number]> = [];
    for (const [path, entry] of this.entries) {
      if (path === uri.path || !path.startsWith(dirPath)) {
        continue;
      }
      const rest = path.slice(dirPath.length);
      if (rest.length > 0 && !rest.includes('/')) {
        children.push([rest, entry.isDirectory ? 2 : 1]);
      }
    }
    return children.sort(([left], [right]) => left.localeCompare(right));
  }

  async exists(uri: UriComponents): Promise<boolean> {
    return this.entries.has(uri.path);
  }

  async createDirectory(uri: UriComponents): Promise<void> {
    this.addDirectory(uri.path);
  }

  async delete(uri: UriComponents): Promise<void> {
    this.entries.delete(uri.path);
  }
}

class MockConfigProvider implements ConfigProvider {
  getWorkspaceFolders() {
    return [{ uri: uri('/workspace'), name: 'workspace', index: 0 }];
  }

  async findFiles(_pattern: string): Promise<UriComponents[]> {
    return [];
  }
}

function uri(path: string): UriComponents {
  return { scheme: 'test', authority: '', path, query: '', fragment: '' };
}

function makeRoot(): CoggitWorkspaceRoot {
  return {
    id: 'root',
    label: 'root',
    workspaceFolder: { uri: uri('/workspace'), name: 'workspace', index: 0 },
    configUri: uri('/workspace/.coggit/config.yaml'),
    projectRootUri: uri('/workspace'),
    sourceRootUri: uri('/workspace/src'),
    cognitionRootUri: uri('/workspace/cognition'),
  };
}

/**
 * Fixture variety: a fresh pair, a template-stale pair, an untracked file
 * (no cognition), and a folder mixing one fresh child with one untracked
 * child. The root README is maintained and fresh. Anchors below assert the
 * variety actually materializes, so the agreement assertions cannot pass
 * on a degenerate all-fresh fixture.
 */
async function makeFixture() {
  const fs = new MockFileSystem();
  fs.addDirectory('/workspace/src', 1000);
  fs.addDirectory('/workspace/cognition', 2000);

  // fresh pair: cognition newer than source, substantive content
  // (isTemplateContent treats <=2 non-empty lines as template-shaped, so
  // maintained fixtures need at least three)
  fs.addFile('/workspace/src/fresh.ts', 'export const fresh = 1;\n', 1000);
  fs.addFile(
    '/workspace/cognition/fresh.ts.md',
    '# fresh\n\nSubstantive maintained notes about the fresh module.\nThey cover the export and its usage.\n',
    2000,
  );

  // template-stale pair: cognition exists but is still template-shaped
  fs.addFile('/workspace/src/template.ts', 'export const template = 1;\n', 1000);
  fs.addFile('/workspace/cognition/template.ts.md', '# template\n', 2000);

  // untracked file: no cognition at all
  fs.addFile('/workspace/src/missing.ts', 'export const missing = 1;\n', 1000);

  // mixed folder: one fresh child, one untracked child, no folder README
  fs.addDirectory('/workspace/src/mixed', 1000);
  fs.addFile('/workspace/src/mixed/a.ts', 'export const a = 1;\n', 1000);
  fs.addFile(
    '/workspace/cognition/mixed/a.ts.md',
    '# a\n\nSubstantive maintained notes about the a module.\nThey cover the export and its usage.\n',
    2000,
  );
  fs.addFile('/workspace/src/mixed/b.ts', 'export const b = 1;\n', 1000);

  // maintained, fresh root README
  fs.addFile(
    '/workspace/cognition/README.md',
    '# root\n\nSubstantive maintained notes about the whole source tree.\nThey cover the tree layout and its modules.\n',
    2000,
  );

  const project = await openCoggitProject(
    { fs, config: new MockConfigProvider() },
    makeRoot(),
  );
  const snapshot = await buildSnapshotFromProjects([project]);
  return { project, snapshot };
}

/** Comparable issue facts: everything the DTO issue projection carries. */
function issueFact(issue: CoggitOperationIssue): string {
  const actionLabels = issue.actions.map((action) => action.label).join(',');
  return `${issue.relativePath}|${issue.severity}|${issue.code}|${issue.message}|${actionLabels}`;
}

function issueFacts(issues: readonly CoggitOperationIssue[]): string[] {
  return issues.map(issueFact);
}

suite('status face agreement — operation DTO vs snapshot object', () => {
  test('both faces agree on the status trio, stale action, and issues per node', async () => {
    const { project, snapshot } = await makeFixture();
    const inspectedPaths = ['.', 'mixed', 'fresh.ts', 'template.ts', 'missing.ts', 'mixed/a.ts', 'mixed/b.ts'];

    const seenStatuses = new Set<string>();
    let sawOwnIssue = false;
    let sawDescendantIssue = false;

    for (const path of inspectedPaths) {
      const node = resolveNodeInSnapshot(snapshot, project.root, path).node;
      assert.ok(node, `fixture node missing for ${path}`);

      // Resolve the DTO against the same snapshot so both faces describe
      // the same node objects (the production funnel shape).
      const all = await statusOperation([project], path, {
        snapshot,
        issueVisibility: 'all',
      });
      assert.strictEqual(all.found, true, `status DTO miss for ${path}`);

      // ── status trio: DTO null encoding vs snapshot undefined encoding ──
      assert.strictEqual(
        all.status,
        node.status?.observedStatus ?? null,
        `whole-node status disagrees for ${path}`,
      );
      assert.strictEqual(
        all.ownStatus,
        node.status?.ownObservedStatus ?? null,
        `own status disagrees for ${path}`,
      );
      assert.strictEqual(
        all.descendantStatus,
        node.status?.descendantObservedStatus ?? null,
        `descendant status disagrees for ${path}`,
      );
      assert.strictEqual(
        all.staleAction,
        node.status?.staleAction ?? null,
        `stale action disagrees for ${path}`,
      );
      seenStatuses.add(String(all.status));

      // ── issues at full visibility: DTO projection vs snapshot facts ──
      const subtree = collectSubtreeIssues(node);
      const own = subtree.filter((located) => located.nodeId === node.id);
      const descendants = subtree.filter((located) => located.nodeId !== node.id);

      assert.strictEqual(
        all.ownIssueCount,
        own.length,
        `own issue count disagrees for ${path}`,
      );
      assert.strictEqual(
        all.descendantIssueCount,
        descendants.length,
        `descendant issue count disagrees for ${path}`,
      );
      assert.strictEqual(
        all.issueCount,
        own.length + descendants.length,
        `total issue count disagrees for ${path}`,
      );
      sawOwnIssue = sawOwnIssue || own.length > 0;
      sawDescendantIssue = sawDescendantIssue || descendants.length > 0;

      const expectedFacts = [...own, ...descendants].map((located) => issueFact({
        relativePath: located.relativePath,
        severity: located.issue.diagnostic.severity,
        code: located.issue.diagnostic.code,
        message: located.issue.diagnostic.message,
        actions: located.issue.actions.map((action) => ({
          code: '',
          label: action.label,
          sourcePath: located.relativePath,
        })),
      }));
      assert.deepStrictEqual(
        issueFacts(all.issues),
        expectedFacts,
        `full-visibility issue facts disagree for ${path}`,
      );

      // ── cognition presence: DTO derives it from the node's own coverage ──
      assert.strictEqual(
        all.inspection?.cognitionPresence,
        node.ownStatus?.coverage?.ownCognition ?? 'not-applicable',
        `cognition presence disagrees for ${path}`,
      );

      // ── suggested actions cite only the inspected node's path ──
      for (const action of all.suggestedActions) {
        assert.strictEqual(
          action.sourcePath,
          all.sourcePath,
          `suggested action cites a foreign path for ${path}`,
        );
      }
    }

    // Fixture anchors: the agreement above is only meaningful because the
    // fixture actually exercises distinct states and non-empty projections.
    assert.ok(seenStatuses.has('fresh'), 'fixture must contain a fresh node');
    assert.ok(seenStatuses.has('stale'), 'fixture must contain a stale node');
    assert.ok(seenStatuses.has('null'), 'fixture must contain a no-cognition node');
    assert.ok(sawOwnIssue, 'fixture must produce an own issue');
    assert.ok(sawDescendantIssue, 'fixture must produce a descendant issue');
  });

  test('the default maintained visibility is the snapshot subtree filtered by paired cognition', async () => {
    const { project, snapshot } = await makeFixture();

    for (const path of ['.', 'mixed', 'template.ts', 'missing.ts']) {
      const node = resolveNodeInSnapshot(snapshot, project.root, path).node;
      assert.ok(node, `fixture node missing for ${path}`);

      const maintained = await statusOperation([project], path, { snapshot });
      assert.strictEqual(maintained.found, true, `status DTO miss for ${path}`);

      const expected = collectSubtreeIssues(node)
        .filter((located) => located.hasPairedCognition === true);
      const expectedOwn = expected.filter((located) => located.nodeId === node.id);
      const expectedDescendants = expected.filter((located) => located.nodeId !== node.id);

      assert.strictEqual(
        maintained.ownIssueCount,
        expectedOwn.length,
        `maintained own issue count disagrees for ${path}`,
      );
      assert.strictEqual(
        maintained.descendantIssueCount,
        expectedDescendants.length,
        `maintained descendant issue count disagrees for ${path}`,
      );
      const expectedFacts = expected.map((located) => issueFact({
        relativePath: located.relativePath,
        severity: located.issue.diagnostic.severity,
        code: located.issue.diagnostic.code,
        message: located.issue.diagnostic.message,
        actions: located.issue.actions.map((action) => ({
          code: '',
          label: action.label,
          sourcePath: located.relativePath,
        })),
      }));
      assert.deepStrictEqual(
        issueFacts(maintained.issues),
        expectedFacts,
        `maintained issue facts disagree for ${path}`,
      );
    }

    // The maintained filter must actually drop untracked-node issues on
    // this fixture (missing.ts and its untracked siblings), otherwise the
    // assertion above is vacuous.
    const missingNode = resolveNodeInSnapshot(snapshot, project.root, 'missing.ts').node;
    assert.ok(missingNode);
    const missingMaintained = await statusOperation([project], 'missing.ts', { snapshot });
    assert.strictEqual(missingMaintained.issueCount, 0);
    const missingAll = await statusOperation([project], 'missing.ts', {
      snapshot,
      issueVisibility: 'all',
    });
    assert.ok(missingAll.issueCount > 0);
  });

  test('fixture anchors: fresh, template-stale, and untracked states materialize', async () => {
    const { project, snapshot } = await makeFixture();

    const fresh = await statusOperation([project], 'fresh.ts', { snapshot });
    assert.strictEqual(fresh.status, 'fresh');
    assert.strictEqual(fresh.issueCount, 0);

    const template = await statusOperation([project], 'template.ts', { snapshot });
    assert.strictEqual(template.status, 'stale');
    assert.strictEqual(template.ownIssueCount, 1);
    assert.strictEqual(template.issues[0]?.code, 'template-cognition');

    const missing = await statusOperation([project], 'missing.ts', { snapshot });
    assert.strictEqual(missing.status, null);
    assert.strictEqual(missing.ownStatus, null);

    // The folder aggregates its tracked descendant and skips the untracked
    // one, on both faces by construction of the assertions above.
    const mixed = resolveNodeInSnapshot(snapshot, project.root, 'mixed').node;
    assert.ok(mixed);
    assert.strictEqual(mixed.status?.observedStatus, 'fresh');
    assert.strictEqual(mixed.status?.descendantObservedStatus, 'fresh');
    assert.strictEqual(mixed.ownStatus?.observedStatus, undefined);
  });
});
