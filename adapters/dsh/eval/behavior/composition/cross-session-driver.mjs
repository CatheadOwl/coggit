/**
 * The cross-session composition driver (issue 20260913 regression): a Cordis
 * plugin mounted through the eval overlay INSTEAD of the one-shot
 * headless-runner. It drives TWO sequential main agents inside ONE host
 * process — the exact topology the behavior-experiment face cannot express
 * (each run there boots a fresh host with a single session, so cross-session
 * closure state is out of its domain; dsh-extra eval docs record the
 * boundary) and the shape the original delivery bug lived in: plugin closures
 * (the cognition-link provider's render state) are shared by construction.
 *
 * Plan (env COGGIT_CROSS_SESSION_PLAN, JSON): `{ cwd, sessions: [{ id, task }] }`.
 * Each entry becomes one `agents.create({ sessionId: id, meta: { cwd } })` plus
 * one followup driven to idle. Output contract mirrors the multi-turn driver:
 * per-session markers on stdout, exit 0 iff every session drove and flushed.
 */
import { readFileSync } from 'node:fs'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

const PLAN_ENV = 'COGGIT_CROSS_SESSION_PLAN'

/** One user-role task message. */
function taskMessage(text) {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

async function run(ctx, plan, io) {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('coggit-cross-session-driver: agents/sessions services are unavailable')
  }
  const selection = defaultModel.currentSelection()
  for (const entry of plan.sessions) {
    const { agent } = await agents.create({
      sessionId: entry.id,
      meta: { cwd: plan.cwd },
      agentOptions: { provider: selection.provider, model: selection.model },
    })
    await agent.whenIdle()
    agent.followup(taskMessage(entry.task))
    await agent.whenIdle()
    await sessions.flush(agent.session)
    io.stdout.write(`coggit-cross-session-driver: session ${entry.id} driven\n`)
  }
  io.exit(0)
}

export const name = 'coggit-cross-session-driver'

export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Mount the cross-session driver from the run plan. */
export function apply(ctx) {
  // Read through the global service store: appExit is an optional launcher
  // host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('coggit-cross-session-driver: the launcher must provide ctx.appExit before the tree mounts')
  }
  const planPath = process.env[PLAN_ENV]
  if (planPath === undefined) {
    throw new Error(`coggit-cross-session-driver: ${PLAN_ENV} must point at the run's plan JSON`)
  }
  const plan = JSON.parse(readFileSync(planPath, 'utf8'))
  const io = { stdout: process.stdout, stderr: process.stderr, exit }
  void run(ctx, plan, io).catch(error => {
    io.stderr.write(`coggit-cross-session-driver: ${error instanceof Error ? error.message : String(error)}\n`)
    exit(1)
  })
}
