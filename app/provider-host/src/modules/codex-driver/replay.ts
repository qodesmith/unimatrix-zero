import type {SkippedSetting} from '#modules/test-recordings/main'

import {SETTINGS_CHECK, machineStandIns} from '#modules/test-recordings/main'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

export const RECORDINGS = path.join(import.meta.dirname, 'recordings')

export const CODEX_HOME_STAND_IN = '/codex-home'

/** A replay puts back the `cwd` the driver last opened a thread or turn in. */
export const TREE_FOLDER_STAND_IN = '/tree-folder'

export const TREES_FOLDER_STAND_IN = '/trees-folder'

const THREAD_SETTINGS = ['config', 'sandbox', 'approvalPolicy', 'cwd'] as const

const TURN_SETTINGS = ['sandboxPolicy', 'approvalPolicy', 'cwd'] as const

/** What the fake compares on a thread's and a turn's request. */
export type CodexSetting =
  | (typeof THREAD_SETTINGS)[number]
  | (typeof TURN_SETTINGS)[number]

export const RecordedMessageSchema = z.looseObject({})

/** `in` is what the driver wrote to `codex`; `out`, what it wrote back. */
export const RecordedLineSchema = z.discriminatedUnion('kind', [
  /** `build` names the `codex` that made the recording, such as `codex 0.163.0`. */
  z.strictObject({kind: z.literal('start'), build: z.string()}),
  z.strictObject({kind: z.literal('in'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('out'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('end')}),
])

export type RecordedLine = z.infer<typeof RecordedLineSchema>

export interface FakeCodexOptions {
  /** Exits like a crash on reading or writing this method. */
  exitAt?: string
  /** Only this many runs, from the first, exit at `exitAt`. */
  exits?: number
  /**
   * Refuses a resume or fork of an unknown thread and goes on, as `codex` does.
   * The recording leaves that request out.
   */
  keepRunningOnRefusal?: boolean
  /** The test's Tree folder, read as the folder the recording's threads ran in. */
  tree?: string
  /** Other folders of the test's, each with the name the recording has for it. */
  standIns?: [string, string][]
  /** Settings the test sends differently from the recording on purpose. */
  skip?: SkippedSetting<CodexSetting>[]
}

const OPTIONS_VARIABLE = 'FAKE_CODEX_OPTIONS'

/** The nth app-server replays the nth recording; reports `<reports>/<n>.json`. */
export function fakeCodexEnv(
  recordings: string[],
  reports: string,
  options: FakeCodexOptions = {}
) {
  return {
    [OPTIONS_VARIABLE]: JSON.stringify({
      recordings,
      reports,
      machine: machineStandIns(),
      ...options,
    }),
  }
}

const NullableStringSchema = z.string().nullable()

export const FakeCodexRunSchema = z.strictObject({
  args: z.array(z.string()),
  home: z.string(),
  cwd: z.string(),
  vendorVariables: z.array(z.string()),
  methods: z.array(z.string()),
  /** What the driver answered each server request. */
  answers: z.array(z.looseObject({id: z.union([z.string(), z.number()])})),
  /** The text of each `turn/start`'s first text item. */
  prompts: z.array(z.string()),
  inputs: z.array(z.array(z.looseObject({type: z.string()}))),
  threadModels: z.array(NullableStringSchema),
  threadConfigs: z.array(z.looseObject({}).nullable()),
  threadInstructions: z.array(NullableStringSchema),
  threadAccess: z.array(z.looseObject({})),
  turnModels: z.array(NullableStringSchema),
  turnAccess: z.array(z.looseObject({})),
  modelLists: z.array(z.looseObject({})),
  resumedFrom: z.array(z.looseObject({type: z.string(), id: z.string()})),
  /** At each `turn/start`, the ids of what the thread held. */
  contexts: z.array(z.array(z.string())),
  injected: z.array(z.looseObject({})),
  /** Which setting differed from the recording, and how. */
  changed: NullableStringSchema,
  forkedThrough: NullableStringSchema,
  interrupted: NullableStringSchema,
  reverted: NullableStringSchema,
  ended: z
    .union([
      z.enum([
        'input-closed',
        'killed',
        'refused',
        'exited',
        'changed-setting',
      ]),
      z.templateLiteral(['unexpected-', z.string()]),
    ])
    .nullable(),
})

/**
 * Like `codex`, resumes or forks only a thread with a rollout under
 * `sessions/`, and a revert writes a new rollout pointing into the old one.
 * Exits when a thread or a turn comes with settings the recording didn't see.
 */
const SCRIPT = `
import fs from 'node:fs'
import path from 'node:path'

const options = JSON.parse(process.env.${OPTIONS_VARIABLE})
const reports = options.reports
const run = fs.readdirSync(reports).length
const reportFile = path.join(reports, run + '.json')
const home = process.env.CODEX_HOME
const standIn = ${JSON.stringify(CODEX_HOME_STAND_IN)}
const treeStandIn = ${JSON.stringify(TREE_FOLDER_STAND_IN)}
let treeFolder = null
const vendorVariables = Object.keys(process.env).filter(name => /^(OPENAI|CODEX|ANTHROPIC|CLAUDE)_/i.test(name))
const report = {args: process.argv.slice(2), home, cwd: process.cwd(), vendorVariables, methods: [], answers: [], prompts: [], inputs: [], threadModels: [], threadConfigs: [], threadInstructions: [], threadAccess: [], turnModels: [], turnAccess: [], modelLists: [], resumedFrom: [], contexts: [], injected: [], changed: null, forkedThrough: null, interrupted: null, reverted: null, ended: null}

function save() {
  fs.writeFileSync(reportFile, JSON.stringify(report))
}
save()
const recording = options.recordings[run]
const [, ...steps] = fs.readFileSync(recording, 'utf8')
  .split('\\n').filter(Boolean).map(line => JSON.parse(line))

${SETTINGS_CHECK}
const THREAD_SETTINGS = ${JSON.stringify(THREAD_SETTINGS)}
const SETTINGS = {'thread/start': THREAD_SETTINGS, 'thread/resume': THREAD_SETTINGS, 'thread/fork': THREAD_SETTINGS, 'turn/start': ${JSON.stringify(TURN_SETTINGS)}}
const recordedTree = steps.find(step => step.kind === 'in' && step.message.method in SETTINGS)?.message.params.cwd
const standIns = [[home, standIn], [options.tree, recordedTree], ...(options.standIns ?? []), ...options.machine]

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
  return method !== undefined && method === options.exitAt && run < (options.exits ?? Infinity)
}

function write(message) {
  if (exitsHere(message.method)) end('exited', 1)
  if ('id' in message && ('result' in message || 'error' in message)) message = {...message, id: ids.get(message.id)}
  let text = JSON.stringify(message).replaceAll(standIn, JSON.stringify(home).slice(1, -1))
  if (treeFolder) text = text.replaceAll(treeStandIn, JSON.stringify(treeFolder).slice(1, -1))
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
    if (message.method === undefined) {
      report.answers.push(message)
      expected(message)
      save()
      answer()
      continue
    }
    report.methods.push(message.method)
    if (['thread/start', 'thread/resume', 'thread/fork', 'turn/start'].includes(message.method)) treeFolder = message.params.cwd ?? treeFolder
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
        if (!options.keepRunningOnRefusal) end('refused', 1)
        save()
        continue
      }
      if (message.method === 'thread/fork') report.forkedThrough = message.params.lastTurnId
    }
    if (message.method === 'thread/start' || message.method === 'thread/fork' || message.method === 'thread/resume') {
      report.threadModels.push(message.params.model ?? null)
      report.threadConfigs.push(message.params.config ?? null)
      report.threadInstructions.push(message.params.developerInstructions ?? null)
      const {cwd, sandbox, approvalPolicy} = message.params
      report.threadAccess.push({cwd, sandbox, approvalPolicy})
    }
    if (message.method === 'turn/start') {
      report.prompts.push(message.params.input.find(item => item.type === 'text')?.text ?? '')
      report.inputs.push(message.params.input)
      report.turnModels.push(message.params.model)
      const {cwd, sandboxPolicy, approvalPolicy} = message.params
      report.turnAccess.push({cwd, sandboxPolicy, approvalPolicy})
      const rollout = rolloutOf(message.params.threadId)
      report.contexts.push(rollout ? historyOf(rollout).map(line => line.id) : [])
    }
    if (message.method === 'model/list') report.modelLists.push(message.params)
    if (message.method === 'thread/inject_items') report.injected.push(...message.params.items)
    if (message.method === 'turn/interrupt') report.interrupted = message.params.turnId
    if (message.method === 'thread/revert') {
      report.reverted = message.params.beforeTurnId
      reverting = cutBefore(message.params.threadId, message.params.beforeTurnId)
    }
    const recorded = expected(message)
    const changed = message.method in SETTINGS ? changedSetting(message.method, SETTINGS[message.method], recorded.params, withStandIns(message.params, standIns), (options.skip ?? []).filter(skip => skip.run === undefined || skip.run === run)) : null
    if (changed) {
      report.changed = changed
      end('changed-setting', 3)
    }
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

/** Run `program` with this Node. */
export async function replayCodex() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-replay-codex-'))
  const program = path.join(folder, 'codex.mjs')
  await fs.writeFile(program, SCRIPT)

  return {
    program,
    cleanUp: async () => fs.rm(folder, {recursive: true, force: true}),
  }
}
