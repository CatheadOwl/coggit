/**
 * Register the coggit-maintenance gate through the gates service seam: local
 * structural mirrors of the frozen gate contract types + the
 * `ctx.inject(['gates'], ...)` soft dependency, so the plugin keeps no hard
 * type/runtime import of the gates package (same registration shape as the
 * cognition-link provider). Diagnostics come from core's single
 * `listMaintenanceDiagnostics()` entry (the surface CI and adapters must
 * consume) and per-item wording is reused from core's maintenance
 * presentation, so the violation copy has one source.
 */
import type { Context } from '@deepseek-ai/cordis'

import { projectMaintenancePresentation } from '@coggit/core'

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

export const MAINTENANCE_GATE: Omit<GateDefinitionLike, 'check'> = {
  id: 'coggit-maintenance',
  description:
    'CogGit maintenance diagnostics: orphaned, misplaced, stray, and unbound cognition entries across every discovered project.',
  rationale:
    'CogGit keeps one cognition document per source path in a fixed mirror layout. '
    + 'Four diagnostic classes cover the maintenance surface: the paired source went missing leaving its cognition behind (orphaned), '
    + 'a cognition file sits off its mirror path (misplaced), cognition-shaped markdown is not yet registered (stray), '
    + 'or is not bound to a source (unbound). '
    + 'Diagnostics are consumed from core\'s single `listMaintenanceDiagnostics()` entry, and the registry is reconciled from the '
    + 'filesystem on read (the filesystem is authoritative), so restoring or moving the files is a complete and safe fix — '
    + 'no registry edit is needed.',
  on: ['stop', 'manual'],
  level: 'blocking',
}

/** Maintenance detection is a pure read: one freshness pass + one discovery scan per project, presented per entry. */
export async function checkMaintenance(root: string): Promise<GateViolationLike[]> {
  const projects = await discoverProjects(root)
  const violations: GateViolationLike[] = []
  for (const project of projects) {
    const view = projectMaintenancePresentation(await project.listMaintenanceDiagnostics())
    for (const item of view.items) {
      violations.push({
        file: item.path,
        reason: `${item.kind}/${item.issueCode}: ${item.message}`,
        remedy: {
          kind: 'manual',
          guidance: item.hint,
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
    }).gates.register({ ...MAINTENANCE_GATE, check: checkMaintenance })
  })
}
