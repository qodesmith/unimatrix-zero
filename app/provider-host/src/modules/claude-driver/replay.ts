import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

/** The recordings the fake `claude` replays, one per `claude` that ran. */
export const RECORDINGS = path.join(import.meta.dirname, 'recordings')

/** One line `claude` and the SDK exchanged, opaque but for its `type`. */
export const RecordedMessageSchema = z.looseObject({type: z.string()})

/**
 * One line of a recording: what the SDK wrote to `claude`'s stdin, what
 * `claude` wrote to its stdout, and the end of its stdin. The first line says
 * where it ran.
 */
export const RecordedLineSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('start'),
    configDir: z.string(),
    projectKey: z.string(),
  }),
  z.strictObject({kind: z.literal('in'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('out'), message: RecordedMessageSchema}),
  z.strictObject({kind: z.literal('end')}),
])

export type RecordedLine = z.infer<typeof RecordedLineSchema>

/**
 * A `claude` that replays a recording: the nth one started replays the nth
 * of `FAKE_CLAUDE_RECORDINGS`. Each line the SDK writes must be the next one
 * recorded, with control request ids and transcript paths mapped onto this
 * run; it answers with what `claude` wrote after it. Like `claude`, it
 * resumes only a session whose transcript is in place, and writes the
 * transcript entries it reports. It writes what it saw to
 * `FAKE_CLAUDE_REPORTS/<n>.json`. `FAKE_CLAUDE_TOOL_RESULT` names a tool
 * result file it writes beside the session; `FAKE_CLAUDE_REFUSE_STORE=yes`
 * refuses to resume from the SDK's temporary folder, as if the store broke.
 */
const SCRIPT = `
import fs from 'node:fs'
import path from 'node:path'

const reports = process.env.FAKE_CLAUDE_REPORTS
const run = fs.readdirSync(reports).length
const reportFile = path.join(reports, run + '.json')
fs.writeFileSync(reportFile, '{}')
const recording = process.env.FAKE_CLAUDE_RECORDINGS.split(path.delimiter)[run]
const lines = fs.readFileSync(recording, 'utf8')
  .split('\\n').filter(Boolean).map(line => JSON.parse(line))
const [start, ...steps] = lines
const configDir = process.env.CLAUDE_CONFIG_DIR
const projectKey = fs.realpathSync(process.cwd()).replace(/[^a-zA-Z0-9]/g, '-')
const projects = path.join(configDir, 'projects', projectKey)
const recordedProjects = path.join(start.configDir, 'projects', start.projectKey)
const args = process.argv.slice(2)
const resume = args.find(arg => arg.startsWith('--resume='))?.slice('--resume='.length)
const report = {args, configDir, prompts: [], resumedFrom: [], toolResults: [], ended: null}

function save() {
  fs.writeFileSync(reportFile, JSON.stringify(report))
}

function refuse(sessionId) {
  report.ended = 'refused'
  save()
  const error = 'No conversation found with session ID: ' + sessionId
  process.stderr.write(error + '\\n')
  process.stdout.write(JSON.stringify({type: 'result', subtype: 'error_during_execution', is_error: true, errors: [error], session_id: sessionId, duration_ms: 0, duration_api_ms: 0, num_turns: 0, stop_reason: null, total_cost_usd: 0, usage: {input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0}, modelUsage: {}, permission_denials: [], uuid: '00000000-0000-4000-8000-000000000000'}) + '\\n')
  process.exit(1)
}

if (resume) {
  const transcript = path.join(projects, resume + '.jsonl')
  const temporary = configDir !== process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR
  if (!fs.existsSync(transcript) || (temporary && process.env.FAKE_CLAUDE_REFUSE_STORE === 'yes')) refuse(resume)
  report.resumedFrom = fs.readFileSync(transcript, 'utf8').split('\\n').filter(Boolean)
    .map(line => JSON.parse(line).uuid).filter(Boolean)
  const toolResults = path.join(projects, resume, 'tool-results')
  report.toolResults = fs.existsSync(toolResults) ? fs.readdirSync(toolResults) : []
}
save()

const requestIds = new Map()
let at = 0

function write(message) {
  if (message.type === 'control_response') {
    message = {...message, response: {...message.response, request_id: requestIds.get(message.response.request_id)}}
  }
  if (message.type === 'transcript_mirror') {
    const filePath = path.join(projects, path.relative(recordedProjects, message.filePath))
    fs.mkdirSync(path.dirname(filePath), {recursive: true})
    fs.appendFileSync(filePath, message.entries.map(entry => JSON.stringify(entry) + '\\n').join(''))
    message = {...message, filePath}
  }
  if (message.type === 'result' && process.env.FAKE_CLAUDE_TOOL_RESULT) {
    const folder = path.join(projects, message.session_id, 'tool-results')
    fs.mkdirSync(folder, {recursive: true})
    fs.writeFileSync(path.join(folder, process.env.FAKE_CLAUDE_TOOL_RESULT), 'A large tool result')
  }
  process.stdout.write(JSON.stringify(message) + '\\n')
}

function answer() {
  while (steps[at]?.kind === 'out') write(steps[at++].message)
}

function expected(kind, matches) {
  const step = steps[at]
  if (step?.kind !== kind || !matches(step)) {
    report.ended = 'unexpected-' + kind
    save()
    process.stderr.write('The recording did not expect this ' + kind + '\\n')
    process.exit(3)
  }
  at += 1
  return step
}

process.on('SIGTERM', () => {
  report.ended = 'killed'
  save()
  process.exit(143)
})

process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  for (let end = buffer.indexOf('\\n'); end >= 0; end = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    const step = expected('in', ({message: recorded}) =>
      recorded.type === message.type &&
      (message.type !== 'control_request' || recorded.request.subtype === message.request.subtype))
    if (message.type === 'control_request') requestIds.set(step.message.request_id, message.request_id)
    if (message.type === 'user') report.prompts.push(message.message.content)
    save()
    answer()
  }
})
process.stdin.on('end', () => {
  expected('end', () => true)
  answer()
  report.ended = 'input-closed'
  save()
  process.exit(0)
})
`

/** Writes the fake into a fresh folder; the SDK runs it with `node`. */
export async function replayClaude() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-replay-claude-'))
  const program = path.join(folder, 'claude.mjs')
  await fs.writeFile(program, SCRIPT)

  return {
    program,
    cleanUp: async () => fs.rm(folder, {recursive: true, force: true}),
  }
}
