/**
 * Wild glance-rate scan — the standing wild metric of the coggit-dsh
 * cognition (wild-glance-rate spec, plain-named per the one-way discipline):
 * of the real host's sessions that RECEIVED a cognition-link injection, how
 * many then read a cognition mirror. Zero model cost; reads session logs
 * only. Research/diagnostic tooling: published for repo readers, and
 * deliberately outside the npm artifact closure (the package `files`
 * allowlist).
 *
 * Eras partition automatically: a session whose system prompt carries the
 * standing directive ('read the linked cognition document…') belongs to the
 * post-overhaul era — the directive default flip and the delivery fix load
 * together at the first host restart past them, so that marker IS the
 * intervention boundary; no manual timestamp needed.
 *
 * Session logs are multi-frame zstd (one frame per write): frames are sliced
 * on the zstd magic (28 B5 2F FD) and decompressed individually — the decode
 * method proven by the 20260913 delivery investigation.
 *
 * Usage:
 *   node scripts/wild-glance-rate.mjs [sessionsRoot] [--since ISO] [--until ISO] [--workspace substr]
 *   (sessionsRoot defaults to $DSH_HOME/sessions, else ~/.dsh/sessions)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const DIRECTIVE_MARK = 'read the linked cognition document'
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

function argValue(flag) {
  const index = process.argv.indexOf(flag)
  return index === -1 ? undefined : process.argv[index + 1]
}

function positionalRoot() {
  const skip = new Set(['--since', '--until', '--workspace'])
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]
    if (skip.has(a)) { i++; continue }
    if (a.startsWith('--')) continue
    return a
  }
  return undefined
}

const root = positionalRoot()
  ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
const since = argValue('--since') ? Date.parse(argValue('--since')) : undefined
const until = argValue('--until') ? Date.parse(argValue('--until')) : undefined
const workspaceFilter = argValue('--workspace')?.toLowerCase()

/** Decompress a multi-frame zstd buffer by slicing on the magic. */
function decodeSessionLog(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const magic = buffer.indexOf(ZSTD_MAGIC, offset)
    if (magic === -1) break
    const next = buffer.indexOf(ZSTD_MAGIC, magic + 4)
    const end = next === -1 ? buffer.length : next
    frames.push(zstdDecompressSync(buffer.subarray(magic, end)))
    offset = end
  }
  if (frames.length === 0) return buffer
  return Buffer.concat(frames)
}

function listFiles(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, out)
    else out.push(path)
  }
  return out
}

function textOf(content) {
  if (!Array.isArray(content)) return ''
  return content.filter(b => b?.type === 'text').map(b => b?.text ?? '').join('')
}

/** Defensive tool/call argument read across log generations. */
function callFilePath(data) {
  const d = data ?? {}
  let args = d.parsedArguments
  if (args === undefined && typeof d.arguments === 'string') {
    try { args = JSON.parse(d.arguments) } catch { args = undefined }
  }
  if (args === undefined) args = d.arguments
  const raw = args?.file_path ?? args?.path ?? d.call?.arguments?.file_path
  return typeof raw === 'string' ? raw : undefined
}

const isMirrorPath = (p) => /(^|[\\/])[a-z0-9_-]*cognition[a-z0-9_-]*[\\/]/i.test(p) && /\.md$/i.test(p)

const files = listFiles(root).filter(f => /session(\.v\d+)?\.jsonl(\.zstd)?$/i.test(f))
const rows = []
for (const file of files) {
  if (workspaceFilter !== undefined && !file.toLowerCase().includes(workspaceFilter)) continue
  const mtime = statSync(file).mtimeMs
  if (since !== undefined && mtime < since) continue
  if (until !== undefined && mtime > until) continue
  let text
  try {
    text = decodeSessionLog(readFileSync(file)).toString('utf8')
  } catch (error) {
    rows.push({ file, mtime, error: `decode: ${error.message}` })
    continue
  }
  const lines = text.split('\n').filter(l => l.trim() !== '')
  let header
  try {
    header = JSON.parse(lines[0])
    if (header.type !== 'session') throw new Error('not a session header')
  } catch (error) {
    rows.push({ file, mtime, error: `header: ${error.message}` })
    continue
  }
  const hasDirective = text.includes(DIRECTIVE_MARK)
  let injectionIndex = -1
  let mirrorReadIndex = -1
  let mirrorReads = 0
  let subagent = header.parentSession !== undefined || header.origin === 'subagent'
  for (let i = 1; i < lines.length; i++) {
    let event
    try { event = JSON.parse(lines[i]) } catch { continue }
    if (event.type === 'user/message' && injectionIndex === -1) {
      const d = event.data ?? {}
      if (d.source?.plugin === 'prompt-middleware' && textOf(d.content).includes('[cognition-link]')) injectionIndex = i
    }
    if (event.type === 'tool/call') {
      const d = event.data ?? {}
      const name = d.name ?? d.call?.name
      const path = callFilePath(d)
      if (name === 'read' && path !== undefined && isMirrorPath(path)) {
        mirrorReads += 1
        if (mirrorReadIndex === -1) mirrorReadIndex = i
      }
    }
  }
  const followRead = injectionIndex !== -1 && mirrorReadIndex > injectionIndex
  rows.push({ file, mtime, subagent, hasDirective, injectionIndex, mirrorReads, followRead })
}

const inWindow = rows.filter(r => r.error === undefined)
const decodeErrors = rows.filter(r => r.error !== undefined)
function summarize(label, subset) {
  const injected = subset.filter(r => r.injectionIndex !== -1)
  const follow = injected.filter(r => r.followRead)
  const rate = injected.length === 0 ? 'n/a' : `${follow.length}/${injected.length} (${Math.round(100 * follow.length / injected.length)}%)`
  console.log(`${label}: scanned=${subset.length} injected=${injected.length} followRead=${rate} (main=${subset.filter(r => !r.subagent).length}, subagent=${subset.filter(r => r.subagent).length})`)
}
console.log(`wild glance-rate scan — root: ${root}`)
if (since !== undefined) console.log(`  since: ${new Date(since).toISOString()}`)
if (until !== undefined) console.log(`  until: ${new Date(until).toISOString()}`)
if (decodeErrors.length > 0) console.log(`  decode/header failures: ${decodeErrors.length} (skipped from stats)`)
summarize('pre-overhaul era (no directive) ', inWindow.filter(r => !r.hasDirective))
summarize('post-overhaul era (directive on)', inWindow.filter(r => r.hasDirective))
if (inWindow.length > 0) {
  const times = inWindow.map(r => r.mtime).sort((a, b) => a - b)
  console.log(`window covered: ${new Date(times[0]).toISOString()} .. ${new Date(times[times.length - 1]).toISOString()}`)
}
