/**
 * Register the coggit-misplaced gate through the gates service seam: local
 * structural mirrors of the frozen gate contract types + the
 * `ctx.inject(['gates'], ...)` soft dependency, so the plugin keeps no hard
 * type/runtime import of the gates package (same registration shape as the
 * cognition-link provider).
 */
import type { Context } from '@deepseek-ai/cordis'

import { discoverProjects } from './service.js'

/** Structural subset of the frozen `GateDefinition` this gate fills (the spec lives with the gates project). */
export interface GateDefinitionLike {
  /** kebab-case, globally unique; duplicates fail loud at registration. */
  id: string
  description: string
  rationale: string
  on: Array<'stop' | 'manual'>
  level: 'blocking' | 'advisory' | 'defer'
  check(root: string): Promise<GateViolationLike[]>
}

/** Structural subset of the frozen `GateViolation` this gate produces. */
export interface GateViolationLike {
  file?: string
  reason: string
  remedy?: { kind: 'manual'; guidance: string }
}

const MISPLACED_GATE: Omit<GateDefinitionLike, 'check'> = {
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
async function checkMisplaced(root: string): Promise<GateViolationLike[]> {
  const projects = await discoverProjects(root)
  const violations: GateViolationLike[] = []
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

/**
 * Soft-dependency registration: only when the gates service is present, the
 * gate enters the `ctx.gates` registry; the inject callback returns the
 * registry's disposer so the Cordis fiber unloads it cleanly.
 */
export function registerCoggitGates(ctx: Context): void {
  void ctx.inject(['gates'], (gatesCtx) => {
    return (gatesCtx as unknown as {
      gates: { register(definition: GateDefinitionLike): unknown }
    }).gates.register({ ...MISPLACED_GATE, check: checkMisplaced })
  })
}
