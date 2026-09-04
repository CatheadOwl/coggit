/**
 * Register the coggit-misplaced gate through gates' hard-import `registerGate`
 * face (ADR 0003). Replaces the former structural-`*Like` + `ctx.inject` +
 * `declare module` ceremony: the gate definition type and the registration
 * wiring now come from `@catheadowl/dsh-extras/gates/register`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerGate } from '@catheadowl/dsh-extras/gates/register'
import type { GateDefinition, GateViolation } from '@catheadowl/dsh-extras/gates/register'

import { discoverProjects } from './service.js'

const MISPLACED_GATE: Omit<GateDefinition, 'check'> = {
  id: 'coggit-misplaced',
  description:
    'CogGit mirror alignment: every tracked source path must have its cognition document at the mirrored location.',
  rationale:
    'CogGit keeps one cognition document per source path in a fixed mirror layout. '
    + 'When a source file is renamed or moved, its cognition must follow so status reads stay aligned. '
    + 'The registry is reconciled from the filesystem on read (the filesystem is authoritative), '
    + 'so moving the cognition file to the expected path is a complete and safe fix — no registry edit is needed.',
  on: ['stop', 'manual'],
  level: 'blocking',
}

/** Misplaced detection is a pure read: registry x 2 stat per entry, reconciled before listing. */
async function checkMisplaced(root: string): Promise<GateViolation[]> {
  const projects = await discoverProjects(root)
  const violations: GateViolation[] = []
  for (const project of projects) {
    for (const entry of await project.listMisplacedCognition()) {
      violations.push({
        file: entry.actualCognitionPath,
        reason:
          `cognition for source ${JSON.stringify(entry.sourcePath)} is misplaced: `
          + `found at ${JSON.stringify(entry.actualCognitionPath)}, `
          + `expected at ${JSON.stringify(entry.expectedCognitionPath)} (mirror alignment)`,
        remedy: {
          kind: 'manual',
          guidance:
            'Move the cognition file to the expected path with an fs tool (read it first, then write it at the expected path and remove the old one). '
            + 'The coggit registry reconciles from the filesystem on read, so the move alone completes the fix.',
        },
      })
    }
  }
  return violations
}

export function registerCoggitGates(ctx: Context): void {
  registerGate(ctx, { ...MISPLACED_GATE, check: checkMisplaced })
}
