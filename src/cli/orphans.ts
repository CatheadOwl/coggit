import type { CoggitProject } from '@coggit/core';
import type { OrphanedCognitionEntry } from '@coggit/core';
import { UserFacingError } from './status';

export interface OrphansCliOptions {
  json?: boolean;
}

interface ProjectOrphans {
  project: {
    id: string;
    label: string;
  };
  orphans: OrphanedCognitionEntry[];
}

export async function runOrphans(
  projects: readonly CoggitProject[],
  options: OrphansCliOptions = {},
): Promise<string> {
  if (projects.length === 0) {
    throw new UserFacingError('No CogGit project found.');
  }

  const groups: ProjectOrphans[] = await Promise.all(projects.map(async (project) => ({
    project: {
      id: project.root.id,
      label: project.root.label,
    },
    orphans: await project.listOrphanedCognition(),
  })));

  if (options.json) {
    return JSON.stringify(groups, null, 2);
  }

  return renderOrphansText(groups);
}

function renderOrphansText(groups: readonly ProjectOrphans[]): string {
  const total = groups.reduce((count, group) => count + group.orphans.length, 0);
  if (total === 0) {
    return 'No orphaned cognition files found.';
  }

  const lines = [`Found ${total} orphaned cognition file(s):`];
  for (const group of groups) {
    if (group.orphans.length === 0) {
      continue;
    }

    lines.push('', `Project: ${group.project.label}`);
    for (const entry of group.orphans) {
      lines.push(`- ${entry.cognitionPath}`);
      lines.push(`  Source: ${entry.sourcePath}`);
      lines.push(`  Type: ${entry.type}`);
    }
  }
  return lines.join('\n');
}
