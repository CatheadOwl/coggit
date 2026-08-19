import type { CoggitOperationAction, CoggitProjectContext } from '../../core/index.js';
import { MCP_TOOL_NAMES } from '../operationDto/shared.js';

export function formatProjectContext(projects: readonly Pick<CoggitProjectContext, 'label' | 'sourceRoot' | 'cognitionRoot'>[]): string {
  if (projects.length === 0) {
    return 'CogGit project context: no configured CogGit project roots discovered.';
  }

  const lines = projects.flatMap((project) => [
    `- Project: ${project.label}`,
    `  Source root: ${project.sourceRoot}`,
    `  Cognition root: ${project.cognitionRoot}`,
  ]);

  return lines.join('\n');
}

export function joinMcpSections(...sections: string[]): string {
  return sections.filter((section) => section.length > 0).join('\n\n');
}

/**
 * Render a surface-mapped operation action to one MCP text line. Operation
 * actions render as `<tool> (args): <label>`; handbook-bearing authoring
 * actions render as `Read <handbookUri>: <label>`, matching the top-level
 * read-before-edit guidance line. Shared by the snapshot and status tools so
 * operation-id → tool-name addressing is formatted in one place.
 */
export function formatOperationAction(action: {
  label: string;
  tool?: string;
  handbookUri?: string;
  sourcePath?: string;
  scope?: string;
  maxDepth?: number;
}): string {
  if (!action.tool && action.handbookUri) {
    return `Read ${action.handbookUri}: ${action.label}`;
  }
  const args: string[] = [];
  if (action.sourcePath) {
    args.push(`sourcePath="${action.sourcePath}"`);
  }
  if (action.scope) {
    args.push(`scope="${action.scope}"`);
  }
  if (action.maxDepth !== undefined) {
    args.push(`maxDepth=${action.maxDepth}`);
  }
  return `${action.tool}${args.length > 0 ? ` (${args.join(', ')})` : ''}: ${action.label}`;
}

/**
 * Next-step line for a non-miss add/resolve failure: map the emitted `status`
 * re-check action to MCP tool addressing (`coggit_status`). Preserves the
 * original re-check prose while sourcing tool name and path from the
 * `suggestedActions` channel that replaced the removed `verify` handle.
 */
export function recheckNextStepText(actions: readonly CoggitOperationAction[]): string {
  for (const action of actions) {
    if (action.operation === 'status' && action.sourcePath) {
      return `Next: verify with ${MCP_TOOL_NAMES[action.operation]} for ${action.sourcePath}.`;
    }
  }
  return '';
}

/** MCP tool response content: text or resource_link. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType: string; description: string };
