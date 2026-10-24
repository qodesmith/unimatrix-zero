import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

/** The recordings the fake `codex` replays, one per app-server that ran. */
export const RECORDINGS = path.join(import.meta.dirname, 'recordings')

/** What a recording says in place of the `CODEX_HOME` it ran with. */
export const CODEX_HOME_STAND_IN = '/codex-home'

/** One JSON-RPC message the driver and `codex` exchanged, opaque to the fake. */
export const RecordedMessageSchema = z.looseObject({})

/**
 * One line of a recording: what the driver wrote to `codex`'s stdin, what
 * `codex` wrote to its stdout, and the end of its stdin.
 */
const RecordedLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('start')}),
  z.strictObject({kind: z.literal('in'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('out'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('end')}),
])

export type RecordedLine = z.infer<typeof RecordedLineSchema>

/**
 * A `codex app-server` that replays a recording: the nth one started replays
 * the nth of `FAKE_CODEX_RECORDINGS`. Each message the driver writes must be
 * the next one recorded, by method, with request ids mapped onto this run;
 * it answers with what `codex` wrote after it, in this run's `CODEX_HOME`.
 * Like `codex`, it writes each thread's rollout, a line per finished turn,
 * and resumes or forks only a thread whose rollout is in place under
 * `sessions/`. It writes what it saw to `FAKE_CODEX_REPORTS/<n>.json`.
 * `FAKE_CODEX_EXIT_AT=<method>` exits instead of answering that request, in
 * each run or only the first `FAKE_CODEX_EXITS`.
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
const report = {args: process.argv.slice(2), home, cwd: process.cwd(), vendorVariables, methods: [], prompts: [], resumedFrom: [], forkedThrough: null, ended: null}

function save() {
  fs.writeFileSync(reportFile, JSON.stringify(report))
}
save()

function rolloutOf(threadId) {
  const sessions = path.join(home, 'sessions')
  if (!fs.existsSync(sessions)) return null
  const name = fs.readdirSync(sessions, {recursive: true}).find(file => file.endsWith('-' + threadId + '.jsonl'))
  return name ? path.join(sessions, name) : null
}

const ids = new Map()
let at = 0

function write(message) {
  if ('id' in message && ('result' in message || 'error' in message)) message = {...message, id: ids.get(message.id)}
  const text = JSON.stringify(message).replaceAll(standIn, JSON.stringify(home).slice(1, -1))
  message = JSON.parse(text)
  const thread = message.result?.thread
  if (thread?.path && !fs.existsSync(thread.path)) {
    fs.mkdirSync(path.dirname(thread.path), {recursive: true})
    fs.writeFileSync(thread.path, JSON.stringify({type: 'session_meta', id: thread.id}) + '\\n')
  }
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
    if (message.method === process.env.FAKE_CODEX_EXIT_AT && run < Number(process.env.FAKE_CODEX_EXITS ?? Infinity)) end('exited', 1)
    if (message.method === 'thread/resume' || message.method === 'thread/fork') {
      const rollout = rolloutOf(message.params.threadId)
      if (!rollout) {
        process.stdout.write(JSON.stringify({id: message.id, error: {code: -32600, message: 'no rollout found for thread id ' + message.params.threadId}}) + '\\n')
        end('refused', 1)
      }
      report.resumedFrom = fs.readFileSync(rollout, 'utf8').split('\\n').filter(Boolean).map(line => JSON.parse(line))
      if (message.method === 'thread/fork') report.forkedThrough = message.params.lastTurnId
    }
    if (message.method === 'turn/start') report.prompts.push(message.params.input[0].text)
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
