import { existsSync, realpathSync } from 'node:fs';
import * as path from 'node:path';

import { UserFacingError } from './status';

/**
 * The skill's name is the command name: the directory under `skills/`, the
 * SKILL.md frontmatter `name`, and the announced `name` all spell `coggit`
 * (not the scoped package name) so the trigger word is the tool word.
 */
export const SKILL_NAME = 'coggit';

export interface SkillsOptions {
  packageRoot: string;
  version: string;
  json?: boolean;
}

/**
 * The locator contract of `--json`. Additive-only: new fields may be added,
 * but none of these four is renamed, retyped, or removed — the machine face
 * is an API consumers script against.
 */
export interface SkillsAnnouncement {
  name: string;
  version: string;
  skillRoot: string;
  skillMd: string;
}

/**
 * Payload announce for the agent skill shipped with this package — tool
 * announces, agent completes. Only the tool knows where the payload lives
 * (the npm root differs per package manager and platform); only the agent
 * knows where it reads skills from. So this command locates the skill tree
 * and stops: package-relative, read-only, any cwd, no project discovery,
 * and it never writes an agent directory — the install (copy or link) is
 * the caller's move, which keeps consent with the party that acts.
 */
export function runSkills(options: SkillsOptions): string {
  const skillRoot = path.join(options.packageRoot, 'skills', SKILL_NAME);
  const skillMd = path.join(skillRoot, 'SKILL.md');
  // Fail loud: an announce that points at nothing is worse than an error.
  if (!existsSync(skillMd)) {
    throw new UserFacingError(`skill payload missing: ${skillMd}`);
  }
  const announcement: SkillsAnnouncement = {
    name: SKILL_NAME,
    version: options.version,
    skillRoot,
    skillMd,
  };
  if (options.json) {
    return JSON.stringify(announcement, null, 2);
  }
  return [
    `${announcement.name}@${announcement.version}`,
    `skill tree: ${skillRoot}`,
    `entry: ${skillMd}`,
    'install: copy or link the whole subtree into your agent\'s skills directory (the destination is yours; this command never writes it). `--json` prints the four locator fields.',
  ].join('\n');
}

/**
 * Package root from the running bundle's directory (`dist/`). The realpath
 * step matters: under `npm link` or a junction the bin resolves to the real
 * package tree, so a linked development install announces the working tree
 * it follows rather than the link path.
 */
export function resolveSkillsPackageRoot(bundleDirectory: string): string {
  return path.dirname(realpathSync(bundleDirectory));
}
