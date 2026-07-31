import type { CoggitProjectContext } from '../../core/index.js';

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

/** MCP tool response content: text or resource_link. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'resource_link'; uri: string; name: string; mimeType: string; description: string };
