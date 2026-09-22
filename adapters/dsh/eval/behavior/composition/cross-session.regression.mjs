/**
 * Cross-session delivery regression (issue 20260913 acceptance #3) — the
 * composition path the dsh-extra defer handed to the consumer side: ONE
 * headless host, TWO sequential main sessions mentioning the SAME path, assert
 * BOTH receive the cognition-link injection. The pre-fix provider (process-
 * global lastRendered) silenced session 2 exactly here; the session-scoped
 * state (ADR-DSH-002) must re-deliver.
 *
 * Deterministic: the eval-mock scripted model answers plain text (no tools),
 * so no credential and no model variance; the assertion reads session logs,
 * not model behavior.
 *
 * The behavior-experiment face runs one fresh host per run and structurally
 * cannot express this topology (dsh-extra eval docs record the boundary), so
 * this script composes the host itself through the experimental entry (no
 * compat promise — the same acceptance the behavior experiments already
 * make): stageProfileStore + buildOverlayYaml + a file://-mounted driver
 * replacing the one-shot headless-runner.
 *
 * Negative control: swapping in the pre-fix provider (commit ac1c0e9^) must
 * turn session 2 RED — a regression that has never seen red detects nothing.
 *
 * Run host-side:
 *   node adapters/dsh/eval/behavior/composition/cross-session.regression.mjs [--keep]
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

import { seedProject, seedFreshCognition } from '../_fixtures/seed-project.mjs'

const { resolveDshCliChain, buildOverlayYaml, stageProfileStore, parseSessionLog } = await import('@catheadowl/dsh-eval/experimental').then(
  (experimental) => experimental,
  () => ({}),
)
if (typeof buildOverlayYaml !== 'function') {
  console.error('cross-session regression: this @catheadowl/dsh-eval release does not carry the experimental composition surface. Upgrade the devDependency.')
  process.exit(1)
}

const PROFILE = process.env.DSH_EVAL_PROFILE ?? 'coggit-headless'
const SOURCE_PATH = 'src/example.ts'
const COGNITION_HREF = 'src_cognition/example.ts.md'
// Identical task text for both sessions: the ONLY difference is the session.
const TASK = `请直接回复 ok，不要调用任何工具：提到 ${SOURCE_PATH}。`
const SESSION_IDS = ['session-cross-1', 'session-cross-2']
const SESSION_LOG = /^session(?:\.v\d+)?\.jsonl$/u
const KEEP = process.argv.includes('--keep') || process.env.DSH_EVAL_KEEP_TMP === '1'
const TIMEOUT_MS = 240_000

/** One scripted model call: plain text "ok", no tools — enough to complete a turn. */
function okStep() {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text: 'ok' },
    { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function listSessionLogFiles(root, out = []) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) listSessionLogFiles(path, out)
    else if (SESSION_LOG.test(basename(path))) out.push(path)
  }
  return out
}

/** Plugin-sourced user-message texts. In the raw v3 log the message fields
 * (content/source/role) sit directly on the event's `data` — only the
 * assistant/message fold nests under `data.message`. */
function enrichmentTexts(events) {
  const texts = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    if (event.data?.source?.plugin !== 'enrichment') continue
    const content = Array.isArray(event.data.content) ? event.data.content : []
    texts.push(content.filter(block => block.type === 'text').map(block => block.text).join(''))
  }
  return texts
}

async function spawnHeadless(cli, cliArgs, cwd, env) {
  const child = spawn(process.execPath, [cli, ...cliArgs], { cwd, env })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
  }, TIMEOUT_MS)
  const exitCode = await new Promise(resolveExit => {
    child.on('error', error => { stderr += `\ncross-session regression: failed to spawn dsh CLI: ${error.message}\n`; resolveExit(127) })
    child.on('exit', code => resolveExit(code ?? 1))
  })
  clearTimeout(timer)
  return { stdout, stderr, exitCode, timedOut }
}

const here = dirname(fileURLToPath(import.meta.url))
const runDir = mkdtempSync(join(tmpdir(), 'coggit-cross-session-'))
let failures = 0
try {
  const dshHome = join(runDir, 'dsh-home')
  const workspace = join(runDir, 'workspace')
  const sessionsRoot = join(runDir, 'sessions')
  mkdirSync(workspace, { recursive: true })
  await seedProject(workspace)
  await seedFreshCognition(workspace)

  const realHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  stageProfileStore(realHome, dshHome, PROFILE)

  const planPath = join(runDir, 'cross-session-plan.json')
  writeFileSync(planPath, JSON.stringify({
    cwd: workspace,
    sessions: SESSION_IDS.map(id => ({ id, task: TASK })),
  }))
  const scriptPath = join(runDir, 'mock-script.json')
  writeFileSync(scriptPath, JSON.stringify({ steps: SESSION_IDS.map(okStep) }))

  // The overlay: the shared mock composition (session-log determinism row,
  // eval-mock model, title-llm off) plus the driver swap replacing the
  // one-shot headless-runner with the two-session driver.
  const driverUrl = pathToFileURL(join(here, 'cross-session-driver.mjs')).href
  const overlayPath = join(runDir, 'cross-session-overlay.yml')
  writeFileSync(overlayPath, buildOverlayYaml({ sessionsRoot, mock: true })
    + `- id: headless-runner\n  disabled: true\n`
    + `- insert:\n    - id: coggit-cross-session-driver\n      name: ${JSON.stringify(driverUrl)}\n`)

  const { cli } = resolveDshCliChain({ repoFlag: process.env.DSH_REPO || undefined, startDir: here })
  const { stdout, stderr, exitCode, timedOut } = await spawnHeadless(
    cli,
    ['--profile', PROFILE, '--patch', overlayPath, 'cross-session regression'],
    workspace,
    {
      ...process.env,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      COGGIT_CROSS_SESSION_PLAN: planPath,
      DSH_EVAL_MOCK_SCRIPT: scriptPath,
    },
  )

  // Evidence first (logs live under the ephemeral runDir), verdict after.
  const artifactsDir = fileURLToPath(new URL(`.runs/cross-session-${new Date().toISOString().replaceAll(/[:.]/g, '-')}/`, import.meta.url))
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(join(artifactsDir, 'stdout.txt'), stdout)
  writeFileSync(join(artifactsDir, 'stderr.txt'), stderr)

  const logsBySession = new Map()
  const logFiles = listSessionLogFiles(sessionsRoot)
  for (const file of logFiles) {
    try {
      const { header, events } = parseSessionLog(readFileSync(file, 'utf8'))
      logsBySession.set(header.id, { file, events })
    } catch (error) {
      failures += 1
      console.log(`  PARSE-FAIL ${basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    cpSync(sessionsRoot, join(artifactsDir, 'sessions'), { recursive: true })
  } catch { /* no session materialized — the verdict below reports it */ }

  console.log(`host exit=${exitCode}${timedOut ? ' (timed out)' : ''} logs=${logFiles.length}`)
  if (exitCode !== 0 || timedOut) {
    failures += 1
    console.log(`  HOST-FAIL see ${artifactsDir}stderr.txt`)
  }

  for (const sessionId of SESSION_IDS) {
    const log = logsBySession.get(sessionId)
    if (log === undefined) {
      failures += 1
      console.log(`  ${sessionId} FAIL no session log (see ${artifactsDir})`)
      continue
    }
    const delivered = enrichmentTexts(log.events).some(text => text.includes('cognition-link') && text.includes(COGNITION_HREF))
    console.log(`  ${sessionId} ${delivered ? 'PASS' : 'FAIL'} cognition-link injection for ${COGNITION_HREF}`)
    if (!delivered) failures += 1
  }

  console.log(failures === 0 ? `cross-session regression: GREEN (artifacts: ${artifactsDir})` : `cross-session regression: RED — ${failures} failure(s) (artifacts: ${artifactsDir})`)
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  // Junctions first, unlinked as links (rmSync would descend into the real
  // store through them), then the temp tree — unless debugging asked to keep
  // it. Same mechanics as the framework's teardownSandbox.
  if (!KEEP) {
    for (const junction of existsSync(runDir) ? collectJunctions() : []) {
      try { unlinkSync(junction) } catch { /* junction absent — nothing to drop */ }
    }
    rmSync(runDir, { recursive: true, force: true })
  } else {
    console.log(`cross-session regression: kept temp run dir ${runDir}`)
  }
}

function collectJunctions() {
  // Junctions were created under the staged profile dir only; re-list them
  // from disk (stageProfileStore's return already holds them, but re-listing
  // keeps teardown correct even if staging partially failed).
  const out = []
  const profiles = join(runDir, 'dsh-home', 'profiles')
  const walk = dir => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) out.push(path)
      else if (entry.isDirectory()) walk(path)
    }
  }
  walk(profiles)
  return out
}
