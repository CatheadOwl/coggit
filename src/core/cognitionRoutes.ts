import type { FileSystem, UriComponents } from './interfaces';
import { parseCognitionDocumentFacts } from './cognitionDocumentFacts';
import type {
  CoggitProjectContext,
  CoggitWorkspaceRoot,
  CognitionRoutes,
  CognitionRoutesEntry,
  CognitionContextStaleRisk,
  CognitionDocumentDiagnostic,
  CognitionDocumentFacts,
  CognitionHeading,
  CognitionMetadataQuality,
  PathKeyRecord,
} from './types';
import { joinUriPath, uriRelativePath } from './uri-utils';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;

export interface BuildCognitionRoutesOptions {
  includeHeadings?: boolean;
  maxHeadingDepth?: number;
}

export interface CognitionRoutesRegistryLookup {
  getEntry(key: string): PathKeyRecord | undefined;
}

interface CognitionMarkdownFile {
  cognitionPath: string;
  uri: UriComponents;
  content: string;
  mtimeMs: number;
}

export async function buildCognitionRoutes(
  root: CoggitWorkspaceRoot,
  fs: FileSystem,
  registryLookup: CognitionRoutesRegistryLookup | null,
  project: CoggitProjectContext,
  options: BuildCognitionRoutesOptions = {},
): Promise<CognitionRoutes> {
  const diagnostics: CognitionDocumentDiagnostic[] = [];
  const files = await collectCognitionMarkdownFiles(root.cognitionRootUri, root.cognitionRootUri, fs, diagnostics);
  const entriesByKey = new Map<string, CognitionRoutesEntry>();
  const duplicatePathsByKey = new Map<string, string[]>();

  files.sort((left, right) => left.cognitionPath.localeCompare(right.cognitionPath));

  for (const file of files) {
    const facts = parseCognitionDocumentFacts(file.cognitionPath, file.content, { mtimeMs: file.mtimeMs });
    const entryDiagnostics = [...facts.diagnostics];
    const registryEntry = registryLookup?.getEntry(facts.key);
    const sourcePaths = sourcePathsFromRegistryEntry(root, registryEntry, entryDiagnostics);
    const entry = buildEntry(facts, registryEntry ?? null, sourcePaths, entryDiagnostics, options);

    const existing = entriesByKey.get(facts.key);
    if (existing) {
      const paths = duplicatePathsByKey.get(facts.key) ?? [existing.cognitionPath];
      paths.push(file.cognitionPath);
      duplicatePathsByKey.set(facts.key, paths);
      continue;
    }

    entriesByKey.set(facts.key, entry);
  }

  for (const [key, paths] of duplicatePathsByKey) {
    const diagnostic: CognitionDocumentDiagnostic = {
      code: 'duplicate-cognition-key',
      severity: 'warning',
      message: `Multiple cognition files resolve to key "${key}": ${paths.join(', ')}.`,
    };
    diagnostics.push(diagnostic);
    const entry = entriesByKey.get(key);
    if (entry) {
      entry.diagnostics.push(diagnostic);
      entry.quality = {
        ...entry.quality,
        metadataQuality: projectMetadataQuality(entry.diagnostics, entry.identity),
      };
    }
  }

  const entries = Array.from(entriesByKey.values());
  diagnostics.push(...entries.flatMap((entry) => entry.diagnostics));

  return {
    project,
    generatedAt: Date.now(),
    entries,
    diagnostics,
  };
}

async function collectCognitionMarkdownFiles(
  rootUri: UriComponents,
  dirUri: UriComponents,
  fs: FileSystem,
  diagnostics: CognitionDocumentDiagnostic[],
): Promise<CognitionMarkdownFile[]> {
  let children: Array<[string, number]>;
  try {
    children = await fs.readDirectory(dirUri);
  } catch {
    diagnostics.push({
      code: 'unreadable-cognition-file',
      severity: 'warning',
      message: `Unable to read cognition directory ${dirUri.path}.`,
    });
    return [];
  }

  const files: CognitionMarkdownFile[] = [];
  for (const [name, type] of children) {
    const childUri = joinUriPath(dirUri, name);
    if (type & FILE_TYPE_DIRECTORY) {
      files.push(...await collectCognitionMarkdownFiles(rootUri, childUri, fs, diagnostics));
      continue;
    }

    if (!(type & FILE_TYPE_FILE) || !name.endsWith('.md')) {
      continue;
    }

    const cognitionPath = uriRelativePath(rootUri, childUri);
    if (!cognitionPath) {
      continue;
    }

    try {
      const [content, stat] = await Promise.all([
        fs.readFile(childUri),
        fs.stat(childUri),
      ]);
      files.push({
        cognitionPath,
        uri: childUri,
        content,
        mtimeMs: stat?.mtimeMs ?? 0,
      });
    } catch {
      diagnostics.push({
        code: 'unreadable-cognition-file',
        severity: 'warning',
        message: `Unable to read cognition file ${cognitionPath}.`,
      });
    }
  }

  return files;
}

function buildEntry(
  facts: CognitionDocumentFacts,
  registryEntry: PathKeyRecord | null,
  sourcePaths: { projectRelativeSourcePath: string | null; toolSourcePath: string | null },
  diagnostics: CognitionDocumentDiagnostic[],
  options: BuildCognitionRoutesOptions,
): CognitionRoutesEntry {
  const identity = {
    name: facts.frontmatter.name,
    description: facts.frontmatter.description,
    retrievalSummary: typeof facts.frontmatter.metadata.retrieval?.summary === 'string'
      ? facts.frontmatter.metadata.retrieval.summary
      : null,
    retrievalIntents: facts.frontmatter.metadata.retrieval?.intents ?? [],
    tags: facts.frontmatter.metadata.tags ?? [],
  };
  const staleRisk: CognitionContextStaleRisk = 'unknown';

  return {
    key: facts.key,
    projectRelativeSourcePath: sourcePaths.projectRelativeSourcePath,
    toolSourcePath: sourcePaths.toolSourcePath,
    cognitionPath: facts.cognitionPath,
    documentKind: facts.kind,
    metadataType: typeof facts.frontmatter.metadata.type === 'string'
      ? facts.frontmatter.metadata.type
      : null,
    identity,
    document: {
      metrics: facts.metrics,
      headings: headingsForOptions(facts.headings, options),
      headingCount: facts.headings.length,
    },
    quality: {
      metadataQuality: projectMetadataQuality(diagnostics, identity),
      staleRisk,
    },
    status: {
      observedStatus: null,
      staleRisk,
    },
    diagnostics,
    suggestedActions: suggestedActionsForEntry(sourcePaths.toolSourcePath, registryEntry),
  };
}

function sourcePathsFromRegistryEntry(
  root: CoggitWorkspaceRoot,
  registryEntry: PathKeyRecord | undefined,
  diagnostics: CognitionDocumentDiagnostic[],
): { projectRelativeSourcePath: string | null; toolSourcePath: string | null } {
  if (!registryEntry?.sourcePath) {
    return { projectRelativeSourcePath: null, toolSourcePath: null };
  }

  const sourceUri = joinRelativePath(root.projectRootUri, registryEntry.sourcePath);
  const toolSourcePath = uriRelativePath(root.sourceRootUri, sourceUri);
  if (toolSourcePath === undefined) {
    diagnostics.push({
      code: 'source-path-outside-source-root',
      severity: 'warning',
      message: `Registry source path "${registryEntry.sourcePath}" is outside the configured source root.`,
    });
    return {
      projectRelativeSourcePath: registryEntry.sourcePath,
      toolSourcePath: null,
    };
  }

  return {
    projectRelativeSourcePath: registryEntry.sourcePath,
    toolSourcePath: toolSourcePath || '.',
  };
}

function headingsForOptions(
  headings: readonly CognitionHeading[],
  options: BuildCognitionRoutesOptions,
): CognitionHeading[] {
  if (options.includeHeadings === false) {
    return [];
  }

  const maxDepth = options.maxHeadingDepth;
  return headings.filter((heading) =>
    maxDepth === undefined
    || (Number.isInteger(maxDepth) && heading.depth <= maxDepth)
  );
}

function projectMetadataQuality(
  diagnostics: readonly CognitionDocumentDiagnostic[],
  identity: { name: string | null; description: string | null },
): CognitionMetadataQuality {
  if (diagnostics.some((diagnostic) =>
    diagnostic.severity === 'error'
    || diagnostic.code === 'missing-frontmatter'
    || diagnostic.code === 'malformed-frontmatter'
  )) {
    return 'poor';
  }

  if (identity.name || identity.description) {
    return diagnostics.length === 0 ? 'good' : 'usable';
  }

  return 'poor';
}

function suggestedActionsForEntry(
  toolSourcePath: string | null,
  _registryEntry: PathKeyRecord | null,
) {
  if (!toolSourcePath) {
    return [];
  }

  return [{
    code: 'diagnose-source-path',
    label: 'Diagnose this source path before explaining or editing it.',
    tool: 'coggit_status' as const,
    sourcePath: toolSourcePath,
  }];
}

function joinRelativePath(rootUri: UriComponents, relativePath: string): UriComponents {
  const segments = relativePath
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');

  return segments.length === 0
    ? rootUri
    : joinUriPath(rootUri, ...segments);
}
