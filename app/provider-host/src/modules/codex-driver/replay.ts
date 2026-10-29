import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

/** One recording per app-server that ran. */
export const RECORDINGS = path.join(import.meta.dirname, 'recordings')

/** What a recording says in place of the `CODEX_HOME` it ran with. */
export const CODEX_HOME_STAND_IN = '/codex-home'

export const RecordedMessageSchema = z.looseObject({})

/** `in` is what the driver wrote to `codex`; `out`, what it wrote back. */
const RecordedLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('start')}),
  z.strictObject({kind: z.literal('in'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('out'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('end')}),
])

export type RecordedLine = z.infer<typeof RecordedLineSchema>

/**
 * The nth `codex app-server` started replays the nth of
 * `FAKE_CODEX_RECORDINGS`, matching each message by method. Like `codex`, it
 * resumes or forks only a thread whose rollout is in place under `sessions/`,
 * and a revert writes the thread a new rollout that points into the old one
 * just before the reverted turn. `contexts` holds, for each `turn/start`, the
 * ids of what the thread's rollouts held then.
 */
const SCRIPT = `
import fs from 'node:fs'
import path from 'node:path'

const reports = process.env.FAKE_CODEX_REPORTS
const run = fs.readdirSync(reports).length
const reportFile = path.join(reports, run + '.json')
fs.writeFileSync(reportFile, '{}')
const recording = process.env.FAKE_CODEX_RECORDINGS.split(path.delimiter)[run]
const [, ...steps] = fs.readFileSync(recording, 'utf8')
  .split('\\n').filter(Boolean).map(line => JSON.parse(line))
const home = process.env.CODEX_HOME
const standIn = ${JSON.stringify(CODEX_HOME_STAND_IN)}
const vendorVariables = Object.keys(process.env).filter(name => /^(OPENAI|CODEX|ANTHROPIC|CLAUDE)_/i.test(name))
const report = {args: process.argv.slice(2), home, cwd: process.cwd(), vendorVariables, methods: [], prompts: [], resumedFrom: [], contexts: [], forkedThrough: null, interrupted: null, reverted: null, ended: null}

function save() {
  fs.writeFileSync(reportFile, JSON.stringify(report))
}
save()

function rollouts() {
  const sessions = path.join(home, 'sessions')
  if (!fs.existsSync(sessions)) return []
  return fs.readdirSync(sessions, {recursive: true}).filter(file => file.endsWith('.jsonl')).map(file => path.join(sessions, file))
}

function rolloutOf(threadId) {
  const own = rollouts().filter(file => {
    const name = path.basename(file)
    return name.endsWith('-' + threadId + '.jsonl') || name.includes('-' + threadId + '_')
  })
  return own.toSorted((a, b) => path.basename(a) < path.basename(b) ? -1 : 1).at(-1) ?? null
}

function historyOf(file, end = Infinity) {
  const lines = fs.readFileSync(file).subarray(0, end).toString('utf8').split('\\n').filter(Boolean).map(line => JSON.parse(line))
  const base = lines[0]?.history_base
  if (!base) return lines
  const source = rollouts().find(other => path.basename(other) === base.rollout)
  if (!source) throw new Error('missing source rollout')
  if (fs.statSync(source).size < base.end_byte_offset) throw new Error('cutoff byte offset is past the source rollout')
  return [...historyOf(source, base.end_byte_offset), ...lines.slice(1)]
}

function cutBefore(threadId, turnId) {
  const rollout = rolloutOf(threadId)
  if (!rollout) return null
  const bytes = fs.readFileSync(rollout)
  let offset = 0
  for (const line of bytes.toString('utf8').split('\\n')) {
    if (line && JSON.parse(line).id === turnId) break
    offset += Buffer.byteLength(line) + 1
  }
  return {rollout: path.basename(rollout), end_byte_offset: Math.min(offset, bytes.length)}
}

let reverting = null

const ids = new Map()
let at = 0

function exitsHere(method) {
  return method !== undefined && method === process.env.FAKE_CODEX_EXIT_AT && run < Number(process.env.FAKE_CODEX_EXITS ?? Infinity)
}

function write(message) {
  if (exitsHere(message.method)) end('exited', 1)
  if ('id' in message && ('result' in message || 'error' in message)) message = {...message, id: ids.get(message.id)}
  const text = JSON.stringify(message).replaceAll(standIn, JSON.stringify(home).slice(1, -1))
  message = JSON.parse(text)
  const thread = message.result?.thread
  if (thread?.path && !fs.existsSync(thread.path)) {
    fs.mkdirSync(path.dirname(thread.path), {recursive: true})
    fs.writeFileSync(thread.path, JSON.stringify({type: 'session_meta', id: thread.id, ...(reverting && {history_base: reverting})}) + '\\n')
  }
  if ('id' in message) reverting = null
  if (message.method === 'turn/completed') {
    const rollout = rolloutOf(message.params.threadId)
    fs.appendFileSync(rollout, JSON.stringify({type: 'turn', id: message.params.turn.id}) + '\\n')
  }
  process.stdout.write(text + '\\n')
}

function answer() {
  while (steps[at]?.kind === 'out') write(steps[at++].message)
}

function end(how, code) {
  report.ended = how
  save()
  process.exit(code)
}

function expected(message) {
  const step = steps[at]
  if (step?.kind !== 'in' || step.message.method !== message.method) {
    process.stderr.write('The recording did not expect ' + message.method + '\\n')
    end('unexpected-' + message.method, 3)
  }
  at += 1
  return step.message
}

process.on('SIGTERM', () => end('killed', 143))

process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  for (let newline = buffer.indexOf('\\n'); newline >= 0; newline = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, newline))
    buffer = buffer.slice(newline + 1)
    report.methods.push(message.method)
    if (exitsHere(message.method)) end('exited', 1)
    if (message.method === 'thread/resume' || message.method === 'thread/fork') {
      const rollout = rolloutOf(message.params.threadId)
      let refusal = rollout ? null : 'no rollout found for thread id ' + message.params.threadId
      try {
        if (rollout) report.resumedFrom = historyOf(rollout)
      } catch (error) {
        refusal = error.message
      }
      if (refusal) {
        process.stdout.write(JSON.stringify({id: message.id, error: {code: -32600, message: refusal}}) + '\\n')
        end('refused', 1)
      }
      if (message.method === 'thread/fork') report.forkedThrough = message.params.lastTurnId
    }
    if (message.method === 'turn/start') {
      report.prompts.push(message.params.input[0].text)
      const rollout = rolloutOf(message.params.threadId)
      report.contexts.push(rollout ? historyOf(rollout).map(line => line.id) : [])
    }
    if (message.method === 'turn/interrupt') report.interrupted = message.params.turnId
    if (message.method === 'thread/revert') {
      report.reverted = message.params.beforeTurnId
      reverting = cutBefore(message.params.threadId, message.params.beforeTurnId)
    }
    const recorded = expected(message)
    if ('id' in message) ids.set(recorded.id, message.id)
    save()
    answer()
  }
})
process.stdin.on('end', () => {
  if (steps[at]?.kind !== 'end') end('unexpected-end', 3)
  at += 1
  answer()
  end('input-closed', 0)
})
`

/** Writes the fake into a fresh folder; run it with this Node. */
export async function replayCodex() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-replay-codex-'))
  const program = path.join(folder, 'codex.mjs')
  await fs.writeFile(program, SCRIPT)

  return {
    program,
    cleanUp: async () => fs.rm(folder, {recursive: true, force: true}),
  }
}
