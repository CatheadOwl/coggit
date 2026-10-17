// coggit-maintenance gate tests against a REAL temp fixture: the gate check is
// called directly (the registration seam shape is unchanged from the gate this
// one replaces), asserting it consumes core's full maintenance-diagnostics set
// — a planted cognition note with no source must surface as a violation
// carrying core's maintenance-presentation wording.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createInitializedProject, makeTempDir, removeTempDir } from './helpers.mjs'

const { MAINTENANCE_GATE, checkMaintenance } = await import('../lib/types/gates.js')

test('gate definition names the full maintenance-diagnostics scope, not a single check', () => {
  assert.equal(MAINTENANCE_GATE.id, 'coggit-maintenance')
  for (const klass of ['orphaned', 'misplaced', 'stray', 'unbound']) {
    assert.ok(
      MAINTENANCE_GATE.description.includes(klass) && MAINTENANCE_GATE.rationale.includes(klass),
      `definition must name the ${klass} class`,
    )
  }
  assert.ok(!MAINTENANCE_GATE.description.includes('mirror alignment'))
})

test('checkMaintenance reports a planted unbound cognition note as a violation', async () => {
  const dir = await makeTempDir('coggit-gate-maintenance')
  try {
    await createInitializedProject(dir)
    // Cognition-shaped = source-pairing naming (`<name>.<ext>.md`); free-form
    // `orphan-note.md` is by design outside every diagnostic class.
    const notePath = join(dir, 'src_cognition', 'orphan.ts.md')
    await writeFile(notePath, '# Orphan note\n\nCognition-shaped markdown with no source candidate.\n', 'utf8')
    const violations = await checkMaintenance(dir)
    const hit = violations.filter((v) => v.file !== undefined && v.file.replaceAll('\\', '/').endsWith('src_cognition/orphan.ts.md'))
    assert.ok(hit.length >= 1, 'the planted note must surface as a violation')
    for (const v of hit) {
      assert.match(v.reason, /^(orphaned|misplaced|stray|unbound)\//, 'reason carries the diagnostic class prefix')
      assert.ok(v.remedy && v.remedy.guidance.length > 0, 'violation carries core presentation guidance')
    }
  } finally {
    await removeTempDir(dir)
  }
})

test('checkMaintenance on a freshly initialized project stays clean', async () => {
  const dir = await makeTempDir('coggit-gate-clean')
  try {
    await createInitializedProject(dir)
    assert.deepEqual(await checkMaintenance(dir), [])
  } finally {
    await removeTempDir(dir)
  }
})
