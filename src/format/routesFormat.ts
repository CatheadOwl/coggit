import type { RoutesPresentationContent } from '../core/routesProjection.js';
import { countRouteNodes } from '../core/routesProjection.js';

export type RoutesTextSurface = 'cli' | 'mcp';

/**
 * Consumer-agnostic routes text rendering.
 * The `surface` parameter controls minor wording differences (e.g. "--depth" vs "depth").
 */
export function routesContentText(
  content: RoutesPresentationContent,
  surface: RoutesTextSurface = 'cli',
): string {
  const routeCount = content.routes?.length ?? 0;
  const tree = content.tree ?? [];
  const isTree = content.tree !== undefined;
  const treeCount = tree.length;
  const totalNodes = countRouteNodes(tree);
  const outputCount = isTree ? treeCount : routeCount;
  const sourcePath = content.sourcePath;
  const pathHints = content.pathHints ?? [];

  const depthFlag = surface === 'cli' ? '--depth' : 'depth';
  const lines: string[] = ['CogGit cognition route map'];

  if (sourcePath && outputCount === 0) {
    lines.push(content.pathMissMessage ?? `No tracked cognition routes matched "${sourcePath}".`);
    lines.push(`This ${surface === 'cli' ? 'command' : 'tool'} expects paths relative to the source root "${content.project.sourceRoot}"; use "." for that root.`);
    if (pathHints.length > 0) {
      if (content.pathHintMessage) {
        lines.push(content.pathHintMessage);
      }
      lines.push(`Try: ${pathHints.map((hint) => `\`${hint}\``).join(', ')}`);
    }
  } else if (routeCount === 0 && !isTree) {
    lines.push('No tracked cognition routes found.');
  } else {
    let detail = isTree
      ? `${treeCount} top-level route(s)`
      : `${routeCount} route(s)`;
    if (isTree && totalNodes > treeCount) {
      detail += `, ${totalNodes} node(s) total`;
    }
    detail += ` - increase ${depthFlag} to expand a route branch.`;
    lines.push(detail);
  }

  lines.push(`Depth: ${content.depth}`);

  if (!isTree && routeCount > 0) {
    lines.push('Routes:');
    lines.push(...(content.routes ?? []));
  } else if (isTree && treeCount > 0) {
    lines.push(surface === 'cli'
      ? 'Tree output is available with --json.'
      : 'Tree output is available in structuredContent.tree.');
  }

  lines.push(surface === 'cli'
    ? 'Use route cognition values as cognition-root-relative grep/read targets for full context. Lines prefixed with [truncated: N] mark branches whose children were omitted; increase --depth or narrow the path to expand them.'
    : 'Use structuredContent.routes cognition values as cognition-root-relative grep/read targets for full context, and continue deeper through child nodes as needed. Lines prefixed with [truncated: N] mark branches whose children were omitted; increase depth or pass sourcePath to expand them.');

  return lines.join('\n');
}
