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
