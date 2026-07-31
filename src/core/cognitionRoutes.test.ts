import * as assert from 'node:assert';

import type { FileStat, FileSystem, UriComponents } from './interfaces';
import type { CoggitProjectContext, CoggitWorkspaceRoot, PathKeyRecord } from './types';
import {
  buildCognitionRoutes,
  type CognitionRoutesRegistryLookup,
} from './cognitionRoutes';

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

class MockRegistryLookup implements CognitionRoutesRegistryLookup {
  constructor(private readonly entries: Record<string, PathKeyRecord>) {}

  getEntry(key: string): PathKeyRecord | undefined {
    return this.entries[key];
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

function makeProjectContext(): CoggitProjectContext {
  return {
    label: 'root',
    configUri: 'test:///workspace/.coggit/config.yaml',
    projectRootUri: 'test:///workspace',
    sourceRootUri: 'test:///workspace/src',
    cognitionRootUri: 'test:///workspace/cognition',
    sourceRoot: 'src',
    cognitionRoot: 'cognition',
    sourcePathRule: 'Use source-root-relative paths with CogGit tools.',
  };
}

function registryEntry(sourcePath: string | null): PathKeyRecord {
  return {
    sourcePath,
    type: 'leaf',
    sourceFactMtimeMs: null,
    cognitionMtimeMs: null,
    verificationTimeMs: null,
    createdAt: null,
    sourceFactHash: null,
    cognitionBlobHash: null,
    cognitionLength: null,
  };
}

suite('cognitionRoutes — buildCognitionRoutes', () => {
  test('builds a DTO entry from document facts and registry source binding', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/core/status.ts.md', [
      '---',
      'name: core-status',
      'description: Status computation reference',
      'metadata:',
      '  type: reference',
      '  tags:',
      '    - status',
      '  retrieval:',
      '    summary: Route status questions here.',
      '    intents:',
      '      - diagnose status',
      '---',
      '# Status',
      '## Evidence',
      '### Details',
    ].join('\n'), 1234);
    const registry = new MockRegistryLookup({
      'core/status.ts': registryEntry('src/core/status.ts'),
    });

    const index = await buildCognitionRoutes(
      makeRoot(),
      fs,
      registry,
      makeProjectContext(),
      { maxHeadingDepth: 2 },
    );

    assert.strictEqual(index.entries.length, 1);
    const [entry] = index.entries;
    assert.strictEqual(entry.key, 'core/status.ts');
    assert.strictEqual(entry.projectRelativeSourcePath, 'src/core/status.ts');
    assert.strictEqual(entry.toolSourcePath, 'core/status.ts');
    assert.strictEqual(entry.documentKind, 'leaf');
    assert.strictEqual(entry.metadataType, 'reference');
    assert.strictEqual(entry.identity.name, 'core-status');
    assert.deepStrictEqual(entry.identity.retrievalIntents, ['diagnose status']);
    assert.strictEqual(entry.quality.metadataQuality, 'good');
    assert.strictEqual(entry.status.observedStatus, null);
    assert.strictEqual(entry.status.staleRisk, 'unknown');
    assert.deepStrictEqual(entry.document.headings.map((heading) => heading.text), ['Status', 'Evidence']);
    assert.strictEqual(entry.document.headingCount, 3);
    assert.ok(entry.suggestedActions.some((action) =>
      action.tool === 'coggit_status' && action.sourcePath === 'core/status.ts'
    ));
  });

  test('keeps missing-frontmatter documents visible with poor metadata quality', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/no-frontmatter.md', '# No Frontmatter');

    const index = await buildCognitionRoutes(makeRoot(), fs, null, makeProjectContext());
    const [entry] = index.entries;

    assert.strictEqual(entry.key, 'no-frontmatter');
    assert.strictEqual(entry.projectRelativeSourcePath, null);
    assert.strictEqual(entry.toolSourcePath, null);
    assert.strictEqual(entry.quality.metadataQuality, 'poor');
    assert.ok(entry.diagnostics.some((diagnostic) => diagnostic.code === 'missing-frontmatter'));
    assert.ok(index.diagnostics.some((diagnostic) => diagnostic.code === 'missing-frontmatter'));
  });

  test('preserves malformed frontmatter diagnostics and keeps the entry visible', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/broken.ts.md', [
      '---',
      'name: [unterminated',
      '---',
      '# Broken',
    ].join('\n'));

    const index = await buildCognitionRoutes(makeRoot(), fs, null, makeProjectContext());
    const [entry] = index.entries;

    assert.strictEqual(entry.key, 'broken.ts');
    assert.strictEqual(entry.quality.metadataQuality, 'poor');
    assert.ok(entry.diagnostics.some((diagnostic) => diagnostic.code === 'malformed-frontmatter'));
    assert.ok(index.diagnostics.some((diagnostic) => diagnostic.code === 'malformed-frontmatter'));
  });

  test('builds document-only entries when registry lookup is absent', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/standalone.ts.md', [
      '---',
      'name: standalone',
      'description: Standalone cognition',
      'metadata:',
      '  type: reference',
      '---',
      '# Standalone',
    ].join('\n'));

    const index = await buildCognitionRoutes(makeRoot(), fs, null, makeProjectContext());
    const [entry] = index.entries;

    assert.strictEqual(entry.key, 'standalone.ts');
    assert.strictEqual(entry.projectRelativeSourcePath, null);
    assert.strictEqual(entry.toolSourcePath, null);
    assert.strictEqual(entry.quality.metadataQuality, 'good');
    assert.deepStrictEqual(entry.suggestedActions, []);
  });

  test('normalizes backslash cognition paths to forward slashes', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/windows\\path.ts.md', [
      '---',
      'name: windows-path',
      'description: Windows-style path',
      'metadata:',
      '  type: reference',
      '---',
      '# Windows Path',
    ].join('\n'));

    const index = await buildCognitionRoutes(makeRoot(), fs, null, makeProjectContext());
    const [entry] = index.entries;

    assert.strictEqual(entry.key, 'windows/path.ts');
    assert.strictEqual(entry.cognitionPath, 'windows/path.ts.md');
  });

  test('reports duplicate cognition keys without last-file-wins replacement', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/src/README.md', [
      '---',
      'name: primary',
      'description: Primary folder cognition',
      'metadata:',
      '  type: folder',
      '---',
      '# Primary',
    ].join('\n'));
    fs.addFile('/workspace/cognition/src\\README.md', [
      '---',
      'name: duplicate',
      'description: Duplicate folder cognition',
      'metadata:',
      '  type: folder',
      '---',
      '# Duplicate',
    ].join('\n'));

    const index = await buildCognitionRoutes(makeRoot(), fs, null, makeProjectContext());

    assert.strictEqual(index.entries.length, 1);
    assert.strictEqual(index.entries[0].key, 'src/');
    assert.strictEqual(index.entries[0].identity.name, 'primary');
    assert.ok(index.entries[0].diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-cognition-key'));
    assert.ok(index.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-cognition-key'));
  });

  test('preserves project-relative source path when it cannot become a tool path', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/other.ts.md', [
      '---',
      'name: other',
      'description: Other source',
      'metadata:',
      '  type: reference',
      '---',
      '# Other',
    ].join('\n'));
    const registry = new MockRegistryLookup({
      'other.ts': registryEntry('external/other.ts'),
    });

    const index = await buildCognitionRoutes(makeRoot(), fs, registry, makeProjectContext());
    const [entry] = index.entries;

    assert.strictEqual(entry.projectRelativeSourcePath, 'external/other.ts');
    assert.strictEqual(entry.toolSourcePath, null);
    assert.ok(entry.diagnostics.some((diagnostic) => diagnostic.code === 'source-path-outside-source-root'));
    assert.deepStrictEqual(entry.suggestedActions, []);
  });

  test('can omit headings from document summaries', async () => {
    const fs = new MockFileSystem();
    fs.addDirectory('/workspace/cognition');
    fs.addFile('/workspace/cognition/headings.ts.md', [
      '---',
      'name: headings',
      'description: Heading controls',
      'metadata:',
      '  type: reference',
      '---',
      '# One',
      '## Two',
    ].join('\n'));

    const index = await buildCognitionRoutes(
      makeRoot(),
      fs,
      null,
      makeProjectContext(),
      { includeHeadings: false },
    );

    assert.deepStrictEqual(index.entries[0].document.headings, []);
    assert.strictEqual(index.entries[0].document.headingCount, 2);
  });
});
