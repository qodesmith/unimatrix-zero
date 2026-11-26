/**
 * Needs a real plan and the env `bun run provider-checks` sets.
 * `UZ_RECORD=yes` rewrites `recordings/`, which the driver tests replay.
 */
import type {Query} from '@anthropic-ai/claude-agent-sdk'
import type {
  ProviderDriver,
  ReplyRecorded,
  ReplyRequest,
  ReplySession,
  SessionRef,
  StartReplyEvent,
  Thread,
} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'
import type {ApprovalAnswer} from '@uz/contract/turns'

import {byPathOnly, pdfSaying, pngShowing} from '#modules/test-attachments/main'
import {markedDeveloperFolder} from '#modules/test-developer-folder/main'
import {heldIdle} from '#modules/test-idle/main'
import {PATH_PROBE, markedPathFolder} from '#modules/test-path-folder/main'
import {listenLocally, startProxy} from '#modules/test-proxy/main'
import {fakeStore} from '#modules/test-store/main'
import {withGitLast} from '#modules/vendor-environment/main'
import {query} from '@anthropic-ai/claude-agent-sdk'
import {isReplyEvent} from '@uz/contract/host'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {afterAll, describe, expect, it} from 'vitest'
import {z} from 'zod'

import {planOf, readAccount} from './account'
import {claudeEnvironment, claudeReplyEnvironment} from './environment'
import {createClaudeDriver, spawnClaude} from './main'
import {runClaudeOneShot} from './one-shot'
import {sandboxSettings} from './permissions'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {projectKeyOf} from './transcripts'

const program = process.env.UZ_LIVE_CLAUDE_PROGRAM ?? ''
const configDir = process.env.UZ_LIVE_CLAUDE_CONFIG ?? ''
const recording = process.env.UZ_RECORD === 'yes'

type Streamed = StartReplyEvent

const TOOLS_PROMPT =
  'Create a file named notes.txt in the current folder holding the single word HERON, with your Write tool, then run `cat notes.txt` with Bash, and reply with only what it printed.'

const InitLine = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('init'),
  tools: z.array(z.string()),
  permissionMode: z.string(),
})

let sharedTreeFolder: string | null = null

function newTreeFolder() {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-tree-'))
  )
}

function treeFolder() {
  sharedTreeFolder ??= newTreeFolder()

  return sharedTreeFolder
}

afterAll(() => {
  if (sharedTreeFolder)
    fs.rmSync(sharedTreeFolder, {recursive: true, force: true})
})

function textOf(events: Streamed[]) {
  return events
    .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
    .join('')
}

function toolCallsIn(events: Streamed[]) {
  return events
    .filter(isReplyEvent)
    .reduce(foldReplyEvent, NEW_REPLY)
    .content.flatMap(part => (part.type === 'tool-call' ? [part] : []))
}

function shownText(events: Streamed[]) {
  return events
    .filter(isReplyEvent)
    .reduce(foldReplyEvent, NEW_REPLY)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

const OutLine = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  terminal_reason: z.string().optional(),
  is_error: z.boolean().optional(),
  errors: z.array(z.string()).optional(),
  message: z.looseObject({model: z.string().optional()}).optional(),
  attempt: z.number().optional(),
  max_retries: z.number().optional(),
  event: z.looseObject({type: z.string()}).optional(),
  abandoned_blocks: z.unknown().optional(),
  state: z.string().optional(),
  command_uuid: z.string().optional(),
})

const SavedEntry = z.looseObject({
  type: z.string(),
  message: z
    .looseObject({
      content: z.union([
        z.string(),
        z.array(z.looseObject({type: z.string(), text: z.string().optional()})),
      ]),
    })
    .optional(),
})

function linesOf(printed: string[]) {
  return printed.map(line => OutLine.parse(JSON.parse(line)))
}

/** `claude` repeats `api_retry` 30 s into an attempt; early ones wait less. */
function waitsWithinAnAttempt(printed: string[]) {
  const attempts = linesOf(printed).flatMap(line =>
    line.subtype === 'api_retry' ? [line.attempt] : []
  )

  return new Set(attempts).size < attempts.length
}

function recordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
  )

  if (!recorded) throw new Error('The Reply was not recorded')

  return recorded
}

function transcriptOf(sessionId: string) {
  return path.join(
    configDir,
    'projects',
    projectKeyOf(treeFolder()),
    `${sessionId}.jsonl`
  )
}

function forgetTranscript(sessionId: string) {
  fs.rmSync(transcriptOf(sessionId), {force: true})
}

function liveDriver(
  files: string[],
  firstEnv: Record<string, string> = {},
  refuses: Parameters<typeof fakeStore>[0] = {},
  hostEnv: NodeJS.ProcessEnv = process.env
) {
  let addedEnv = firstEnv
  let droppedEnv: string[] = []
  let compactionSettings: CompactionSettings = {auto: true, threshold: null}
  const store = fakeStore(refuses)
  const printed: string[] = []
  const queries: Query[] = []

  const recorder = createRecorder(
    ({command, args, cwd, env, signal}) =>
      spawn(command, args, {cwd, env, signal, stdio: 'pipe'}),
    files.map(name => path.join(RECORDINGS, name))
  )

  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const start = recording ? recorder.spawn : spawnClaude

  const driver = createClaudeDriver({
    store: store.client,
    spawn: options => {
      // `claudeEnvironment` strips every `CLAUDE_*` variable from the host's.
      const env = Object.fromEntries(
        Object.entries({...options.env, ...addedEnv}).filter(
          ([name]) => !droppedEnv.includes(name)
        )
      )

      const child = start({...options, env})
      createInterface({input: child.stdout}).on('line', line =>
        printed.push(line)
      )
      exits.push(
        new Promise(resolve => {
          child.on('exit', resolve)
        })
      )

      return child
    },
    env: hostEnv,
    whenIdle: idle.whenIdle,
    query: params => {
      const running = query(params)
      queries.push(running)

      return running
    },
  })

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  const treeId = crypto.randomUUID()

  function request(
    text: string,
    session: ReplyRequest['session']
  ): ReplyRequest {
    return {
      treeId,
      replyId: crypto.randomUUID(),
      model: 'haiku',
      systemPrompt: 'You answer in as few words as you can.',
      prompt: {text, attachments: [], messageId: crypto.randomUUID()},
      vendorProgram: {
        program: {
          path: program,
          build: {url: 'https://x.test/', sha256: '', size: 0},
        },
        configDir,
      },
      treeFolder: treeFolder(),
      session,
      thread: [],
      compactionSettings,
      systemPromptChanged: false,
      tools: DEFAULT_TREE_TOOLS,
      permissionMode: 'full-access',
      hiddenFolders: [],
      treesFolder: '/trees',
      grants: [],
    }
  }

  async function reply(text: string, session: ReplyRequest['session']) {
    const events = await Array.fromAsync(
      driver.startReply(request(text, session))
    )

    expect(events.at(-1)).toMatchObject({status: 'complete'})

    return {events, recorded: recordedIn(events)}
  }

  return {
    driver,
    request,
    reply,
    closed,
    setEnv(env: Record<string, string>) {
      addedEnv = env
    },
    /** For each `claude` started from here on, even ones the driver sets. */
    dropEnv(names: string[]) {
      droppedEnv = names
    },
    setCompaction(next: CompactionSettings) {
      compactionSettings = next
    },
    printed,
    queries,
    entriesOf: (sessionId: string) =>
      store.entriesOf(projectKeyOf(configDir), sessionId),
    entryCount: (sessionId: string) =>
      store.entriesOf(projectKeyOf(configDir), sessionId).length,
    async done() {
      await closed()

      if (recording) await recorder.done()
    },
  }
}

function continuing(session: SessionRef, fork = false): ReplySession {
  return {...session, type: fork ? 'fork' : 'continue'}
}

/** Served only through the Reply, which sits before a Compaction. */
function reaching(session: ReplyRecorded['session']): ReplySession {
  return {...session, type: 'fork', servedThrough: session.messageId}
}

type Live = ReturnType<typeof liveDriver>

const SUPERVISED_WRITE =
  'Create a file named notes.txt in the current folder holding the single word HERON, with your Write tool, then reply with only the word DONE.'

const SECOND_WRITE =
  'Now create more.txt in the current folder holding the single word OSPREY, with your Write tool, then reply with only the word DONE.'

const TWO_WRITES =
  'With your Write tool, create a.txt holding the single word ONE in the current folder, and once that is done create b.txt holding the single word TWO there, then reply with only the word DONE.'

const GRANTED_WRITE =
  'Create a file named c.txt in the current folder holding the single word THREE, with your Write tool, then reply with only the word DONE.'

function supervised(live: Live, text: string, tree: string): ReplyRequest {
  return {
    ...live.request(text, null),
    treeFolder: tree,
    permissionMode: 'supervised',
    hiddenFolders: [],
    treesFolder: '/trees',
  }
}

function approvalsIn(events: Streamed[]) {
  return events.flatMap(event =>
    event.type === 'APPROVAL_REQUESTED' || event.type === 'APPROVAL_RESOLVED'
      ? [event]
      : []
  )
}

/** Answers each card in turn while the Reply waits, as the user would. */
async function answering(
  driver: ProviderDriver,
  request: ReplyRequest,
  answers: ApprovalAnswer[]
) {
  const events: Streamed[] = []
  const left = [...answers]

  for await (const event of driver.startReply(request)) {
    events.push(event)

    if (event.type === 'APPROVAL_REQUESTED') {
      await driver.answerApproval(event.approvalId, left.shift() ?? 'deny')
    }
  }

  return events
}

function controlRequestsIn(live: Live) {
  return live.printed
    .map(line => z.looseObject({type: z.string()}).parse(JSON.parse(line)))
    .flatMap(line => {
      const request = z
        .looseObject({
          type: z.literal('control_request'),
          request: z.looseObject({subtype: z.string()}),
        })
        .safeParse(line)

      return request.success ? [request.data.request.subtype] : []
    })
}

function readIn(tree: string, name: string) {
  return fs.readFileSync(path.join(tree, name), 'utf8').trim()
}

function sandboxedTrees() {
  const root = newTreeFolder()
  const tree = path.join(root, 'one')
  const other = path.join(root, 'two')
  fs.mkdirSync(tree)
  fs.mkdirSync(other)

  return {root, tree, other}
}

/** With the folder that holds `claude`'s own config hidden, as the app has it. */
function inSandbox(
  live: Live,
  text: string,
  trees: ReturnType<typeof sandboxedTrees>
): ReplyRequest {
  return {
    ...supervised(live, text, trees.tree),
    hiddenFolders: [configDir],
    treesFolder: trees.root,
  }
}

const SANDBOXED_COMMAND =
  'Run exactly this command with Bash, once: `echo HERON > notes.txt && printenv SANDBOX_RUNTIME`. Then reply with only what it printed.'

const NETWORK_COMMAND =
  "Run exactly this command with Bash, once: `curl -sS https://example.com -o /dev/null -w '%{http_code}'`. Then reply with only what it printed."

function leavingPrompt(file: string) {
  return `Run exactly this command with Bash: \`echo KESTREL > ${file}\`. If the sandbox blocks it, retry it once with dangerouslyDisableSandbox set to true, and if that is denied too, stop. Then reply with only the word DONE.`
}

function readingPrompt(secret: string, otherSecret: string) {
  return `Do these four steps in order, each once, with no retry, whatever happens: read ${secret} with your Read tool; then read ${otherSecret} with your Read tool; then run exactly \`cat ${otherSecret}\` with Bash; then run exactly \`sh read.sh\` with Bash. Then reply with only the word DONE.`
}

/** The SDK runs a `.mjs` with the `node` on PATH. */
function exitWatcher(ended: string) {
  return `
import {spawn} from 'node:child_process'
import fs from 'node:fs'
const ended = how => fs.writeFileSync(${JSON.stringify(ended)}, how)
const child = spawn(${JSON.stringify(program)}, process.argv.slice(2), {stdio: 'inherit'})
process.on('SIGTERM', () => {
  ended('killed')
  child.kill('SIGKILL')
  process.exit(143)
})
child.on('exit', code => {
  ended('exited')
  process.exit(code ?? 1)
})
`
}

const RECALL =
  'Name my code word, my ship, my color, my pet and my bird, in that order. Write NONE for each one I never told you.'

async function failedOn(live: Live, request: ReplyRequest) {
  const events = await Array.fromAsync(live.driver.startReply(request))

  expect(events.at(-1)).toMatchObject({type: 'RUN_FINISHED', status: 'failed'})

  return events
}

const PADDING = 'The harbor log lists no ships today. '.repeat(300)

/** The lowered limits stay set for every later `claude`. */
async function failedCompaction(
  live: Live,
  env: Record<string, string>,
  fault: () => void
) {
  const padded = await live.reply(
    `My ship is PELICAN. Ignore the rest of this message. ${PADDING}`,
    null
  )

  await live.closed()
  // Set only now: it blocks a first Prompt too, with nothing to compact.
  live.setEnv({
    ...env,
    CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0.2',
    CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE: '2000',
  })
  fault()
  const compacting = live.printed.length

  const blocked = await failedOn(
    live,
    live.request(
      'Reply with the single word OK.',
      continuing(padded.recorded.session)
    )
  )

  const compaction = linesOf(live.printed.slice(compacting))
  const failed = compaction.find(line => line.compact_result === 'failed')
  const result = compaction.find(line => line.type === 'result')

  expect(failureIn(blocked)).toMatchObject({code: 'connection-lost'})
  expect(failed).toMatchObject({subtype: 'status'})
  expect(result).toMatchObject({terminal_reason: 'blocking_limit'})

  return {failed, result}
}

async function compactedThread(live: Live) {
  live.setEnv({CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0.2'})

  const first = await live.reply('My code word is TEAL.', null)

  const second = await live.reply(
    `My ship is PELICAN. Ignore the rest of this message. ${PADDING}`,
    continuing(first.recorded.session)
  )

  const third = await live.reply(
    'My color is CRIMSON.',
    continuing(second.recorded.session)
  )

  expect(third.events).toContainEqual(
    expect.objectContaining({type: 'CONTEXT_COMPACTED'})
  )

  await live.closed()
  live.setEnv({})

  return {first, third}
}

const HOUR_IN_SECONDS = 3600

function apiError(type: string, message: string) {
  return JSON.stringify({type: 'error', error: {type, message}})
}

const RATE_LIMITED = apiError('rate_limit_error', 'Rate limit exceeded')

function standInFailures(resets: number) {
  return {
    'five-hour': {
      status: 429,
      headers: {
        'retry-after': String(2 * HOUR_IN_SECONDS),
        'anthropic-ratelimit-unified-status': 'rejected',
        'anthropic-ratelimit-unified-reset': String(resets),
        'anthropic-ratelimit-unified-representative-claim': 'five_hour',
        'anthropic-ratelimit-unified-5h-status': 'rejected',
        'anthropic-ratelimit-unified-5h-reset': String(resets),
        'anthropic-ratelimit-unified-5h-utilization': '1.0',
        'anthropic-ratelimit-unified-overage-status': 'rejected',
      },
      body: RATE_LIMITED,
    },
    throttle: {status: 429, headers: {}, body: RATE_LIMITED},
    'server-error': {
      status: 500,
      headers: {},
      body: apiError('api_error', 'Internal server error'),
    },
    overloaded: {
      status: 529,
      headers: {},
      body: apiError('overloaded_error', 'Overloaded'),
    },
    'low-credit': {
      status: 400,
      headers: {},
      body: apiError(
        'invalid_request_error',
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'
      ),
    },
    'payment-required': {
      status: 402,
      headers: {},
      body: apiError('billing_error', 'Payment required'),
    },
  }
}

type StandInAnswer = keyof ReturnType<typeof standInFailures> | 'forward'

function forward(request: http.IncomingMessage, response: http.ServerResponse) {
  const upstream = https.request(
    `https://api.anthropic.com${request.url ?? '/'}`,
    {
      method: request.method,
      headers: {...request.headers, host: 'api.anthropic.com'},
    },
    answered => {
      response.writeHead(answered.statusCode ?? 502, answered.headers)
      answered.pipe(response)
    }
  )

  upstream.on('error', () => response.destroy())
  request.pipe(upstream)
}

async function startStandInApi(answer: StandInAnswer = 'five-hour') {
  // One reset for every request, so each failure names the same time.
  const resets = Math.floor(Date.now() / 1000) + 2 * HOUR_IN_SECONDS
  let current = answer

  const failures = standInFailures(resets)

  const server = http.createServer((request, response) => {
    const messages =
      request.method === 'POST' &&
      (request.url ?? '').startsWith('/v1/messages')

    if (!messages || current === 'forward') {
      forward(request, response)

      return
    }

    const failure = failures[current]

    request.resume()
    response.writeHead(failure.status, {
      'content-type': 'application/json',
      ...failure.headers,
    })
    response.end(failure.body)
  })

  return {
    url: await listenLocally(server),
    /** In seconds since the epoch. */
    resets,
    answer(next: StandInAnswer) {
      current = next
    },
    close: () => server.close(),
  }
}

function failureIn(events: Streamed[]) {
  return events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY).failure
}

/** About 12 tokens a sentence, measured. */
function padding(tokens: number) {
  return 'The harbor log lists no ships today. '.repeat(Math.round(tokens / 12))
}

function contextOf(events: Streamed[]) {
  return (
    events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY).contextSize ??
    0
  )
}

function compacted(events: Streamed[]) {
  return events.some(event => event.type === 'CONTEXT_COMPACTED')
}

describe.skipIf(!program || !configDir)('a live Claude', () => {
  it('[dep:project-key-copy] [dep:resume-config-swap-keychain] streams into the project folder the app computes, continues warm, resumes signed in from the app’s copy alone, then forks mid-Thread', async () => {
    const live = liveDriver(['warm.ndjson', 'resumed.ndjson', 'forked.ndjson'])

    const first = await live.reply('Reply with the single word TEAL.', null)

    const second = await live.reply(
      'Now reply with the single word OTTER.',
      continuing(first.recorded.session)
    )

    expect(second.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )

    await live.closed()

    expect(fs.existsSync(transcriptOf(first.recorded.session.sessionId))).toBe(
      true
    )
    expect(live.entryCount(first.recorded.session.sessionId)).toBeGreaterThan(0)

    forgetTranscript(first.recorded.session.sessionId)

    const third = await live.reply(
      'Which two words did you reply with? Just the words.',
      continuing(second.recorded.session)
    )

    expect(textOf(third.events)).toMatch(/TEAL/)
    expect(textOf(third.events)).toMatch(/OTTER/)

    const forked = await live.reply(
      'Which word did you reply with? Just the word.',
      continuing(first.recorded.session, true)
    )

    expect(forked.recorded.session.sessionId).not.toBe(
      first.recorded.session.sessionId
    )
    expect(textOf(forked.events)).toMatch(/TEAL/)
    expect(textOf(forked.events)).not.toMatch(/OTTER/)

    await live.done()
  }, 180_000)

  it('[dep:cut-short-replies] [dep:stop-terminal-reason] stops a Reply mid-stream, which claude ends as aborted yet still marks an error, noting the stop in the session, and continues warm from it, then rewinds a session to an earlier Reply', async () => {
    const live = liveDriver([
      'stopped.ndjson',
      'rewound-warm.ndjson',
      'rewound.ndjson',
    ])

    const counting = live.request(
      'Count from 1 to 300, one number per line.',
      null
    )

    const events: Streamed[] = []
    let deltas = 0

    for await (const event of live.driver.startReply(counting)) {
      events.push(event)

      if (event.type === 'TEXT_DELTA' && ++deltas === 5) {
        await live.driver.stop(counting.replyId)
      }
    }

    expect(textOf(events).length).toBeGreaterThan(0)
    expect(events.at(-1)).toMatchObject({status: 'stopped'})
    expect(
      linesOf(live.printed).find(line => line.type === 'result')
    ).toMatchObject({terminal_reason: 'aborted_streaming', is_error: true})
    const stopped = recordedIn(events)

    const asked = await live.reply(
      'What did I ask you to do? Answer in five words.',
      {...stopped.session, type: 'continue'}
    )

    expect(asked.recorded.session.sessionId).toBe(stopped.session.sessionId)
    expect(JSON.stringify(live.entriesOf(stopped.session.sessionId))).toContain(
      '[Request interrupted by user]'
    )

    const first = await live.reply('Reply with the single word TEAL.', null)

    await live.reply('Now reply with the single word OTTER.', {
      ...first.recorded.session,
      type: 'continue',
    })

    await live.closed()
    forgetTranscript(first.recorded.session.sessionId)

    const rewound = await live.reply(
      'Which word did you reply with? Just the word.',
      {...first.recorded.session, type: 'rewind'}
    )

    expect(rewound.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )
    expect(textOf(rewound.events)).toMatch(/TEAL/)
    expect(textOf(rewound.events)).not.toMatch(/OTTER/)

    await live.done()
  }, 180_000)

  it('forgets a failed Prompt once the next is sent from the Reply above it, for two failures in one session', async () => {
    const live = liveDriver([])

    async function failed(text: string, above: SessionRef) {
      const events = await Array.fromAsync(
        live.driver.startReply({
          ...live.request(text, continuing(above)),
          model: 'claude-made-up-0',
        })
      )

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: expect.anything(),
      })
    }

    const recall =
      'Quote every message I sent you before this one, word for word.'

    const first = await live.reply('Reply with the single word TEAL.', null)

    await failed(
      'Remember the codeword ZANZIBAR and reply with it.',
      first.recorded.session
    )

    const second = await live.reply(recall, {
      ...first.recorded.session,
      type: 'rewind',
    })

    expect(second.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )
    expect(textOf(second.events)).toMatch(/TEAL/)
    expect(textOf(second.events)).not.toMatch(/ZANZIBAR/i)

    await failed(
      'Remember the codeword MARMALADE and reply with it.',
      second.recorded.session
    )

    const third = await live.reply(recall, {
      ...second.recorded.session,
      type: 'rewind',
    })

    expect(third.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )
    expect(textOf(third.events)).toMatch(/TEAL/)
    expect(textOf(third.events)).not.toMatch(/ZANZIBAR|MARMALADE/i)

    await live.done()
  }, 180_000)

  it('cuts after the Prompt of a Retry the app quit in, for a Retry below it and for Turns deleted below it', async () => {
    const live = liveDriver([])

    const recall =
      'Quote every message I sent you before this one, word for word.'

    async function ended(request: ReplyRequest, stopAtText = false) {
      let last: Streamed | null = null
      let stopping = false

      for await (const event of live.driver.startReply(request)) {
        last = event

        if (stopAtText && event.type === 'TEXT_DELTA' && !stopping) {
          stopping = true
          await live.driver.stop(request.replyId)
        }
      }

      return last
    }

    /** Stopping the Retry at its first text leaves the session as a quit would. */
    async function quitInRetry() {
      const first = await live.reply('Reply with the single word TEAL.', null)
      const above = first.recorded.session

      const firstAttempt = {
        ...live.request('Remember the codeword ZANZIBAR.', continuing(above)),
        model: 'claude-made-up-0',
      }

      expect(await ended(firstAttempt)).toMatchObject({status: 'failed'})

      const retry = live.request(
        'Remember the codeword PELICAN, and write three sentences about pelicans.',
        {...above, type: 'rewind'}
      )

      expect(await ended(retry, true)).toMatchObject({status: 'stopped'})

      return {above, keepThrough: retry.prompt.messageId}
    }

    const retried = await quitInRetry()

    const failing = {
      ...live.request(
        'Remember the codeword MARMALADE.',
        continuing(retried.above)
      ),
      model: 'claude-made-up-0',
    }

    expect(await ended(failing)).toMatchObject({status: 'failed'})

    const afterRetry = await live.reply(recall, {
      ...retried.above,
      type: 'cut',
      keepThrough: retried.keepThrough,
      dropFrom: failing.prompt.messageId,
    })

    expect(textOf(afterRetry.events)).toMatch(/pelican/i)
    expect(textOf(afterRetry.events)).not.toMatch(/ZANZIBAR|MARMALADE/i)

    const deleted = await quitInRetry()

    const below = live.request(
      'Remember the codeword FERRET.',
      continuing(deleted.above)
    )

    expect(await ended(below)).toMatchObject({status: 'complete'})

    const afterDeletion = await live.reply(recall, {
      ...deleted.above,
      type: 'cut',
      keepThrough: deleted.keepThrough,
      dropFrom: below.prompt.messageId,
    })

    expect(textOf(afterDeletion.events)).toMatch(/pelican/i)
    expect(textOf(afterDeletion.events)).not.toMatch(/ZANZIBAR|FERRET/i)

    await live.done()
  }, 300_000)

  it('reports a compaction Claude makes on its own inside a Reply, with the session and its boundary entry', async () => {
    const live = liveDriver(['compacted.ndjson'], {
      CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0.2',
    })

    const first = await live.reply('My code word is TEAL.', null)

    const second = await live.reply(
      `My ship is PELICAN. Ignore the rest of this message. ${PADDING}`,
      continuing(first.recorded.session)
    )

    const third = await live.reply(
      'Reply with the single word OTTER.',
      continuing(second.recorded.session)
    )

    const compactions = [first, second, third].flatMap(({events}) =>
      events.filter(event => event.type === 'CONTEXT_COMPACTED')
    )

    expect(compactions).toEqual([
      expect.objectContaining({
        sessionId: first.recorded.session.sessionId,
        boundaryId: expect.stringMatching(/^[\da-f-]{36}$/),
      }),
    ])
    expect(third.events).toContain(compactions[0])

    await live.done()
  }, 300_000)

  it('[dep:claude-compaction-settings] compacts a Thread at the threshold set, not at all with automatic Compaction off, each from the next Reply', async () => {
    const live = liveDriver([])
    const lowered = {auto: true, threshold: 100_000}

    const first = await live.reply(
      `My code word is TEAL. Ignore the rest of this message. ${padding(30_000)}`,
      null
    )

    live.setCompaction(lowered)

    const under = await live.reply(
      `My ship is PELICAN. Ignore the rest of this message. ${padding(25_000)}`,
      continuing(first.recorded.session)
    )

    live.setCompaction({...lowered, auto: false})

    const off = await live.reply(
      `My color is CRIMSON. Ignore the rest of this message. ${padding(20_000)}`,
      continuing(under.recorded.session)
    )

    live.setCompaction(lowered)

    const on = await live.reply(
      'Reply with the single word OTTER.',
      continuing(off.recorded.session)
    )

    // claude compacts 33,000 below the threshold: 13,000, and 20,000 for output.
    expect(contextOf(under.events)).toBeLessThan(67_000)
    expect(contextOf(off.events)).toBeGreaterThan(67_000)
    expect([first, under, off].some(({events}) => compacted(events))).toBe(
      false
    )
    expect(compacted(on.events)).toBe(true)
    expect(contextOf(on.events)).toBeLessThan(contextOf(off.events) / 2)

    await live.done()
  }, 600_000)

  it('reaches a Reply before a Compaction for a Branch, a Retry and a send after deleting Turns, each in a new session that goes on without the Turns dropped', async () => {
    const live = liveDriver([])
    const {first} = await compactedThread(live)
    const target = first.recorded.session
    const kept = live.entryCount(target.sessionId)

    const branch = await live.reply(RECALL, reaching(target))

    expect(branch.recorded.session.sessionId).not.toBe(target.sessionId)
    expect(textOf(branch.events)).toMatch(/TEAL/)
    expect(textOf(branch.events)).not.toMatch(/PELICAN|CRIMSON/i)

    await failedOn(live, {
      ...live.request('My pet is FERRET.', reaching(target)),
      model: 'claude-made-up-0',
    })

    const retried = await live.reply('My bird is OSPREY.', reaching(target))

    expect(retried.recorded.session.sessionId).not.toBe(target.sessionId)

    await live.closed()

    const afterRetry = await live.reply(
      RECALL,
      continuing(retried.recorded.session)
    )

    expect(afterRetry.recorded.session.sessionId).toBe(
      retried.recorded.session.sessionId
    )
    expect(textOf(afterRetry.events)).toMatch(/TEAL/)
    expect(textOf(afterRetry.events)).toMatch(/OSPREY/)
    expect(textOf(afterRetry.events)).not.toMatch(/PELICAN|CRIMSON|FERRET/i)

    const sent = await live.reply('My pet is WOMBAT.', reaching(target))

    expect(sent.recorded.session.sessionId).not.toBe(target.sessionId)

    await live.closed()

    const afterDeletion = await live.reply(
      RECALL,
      continuing(sent.recorded.session)
    )

    expect(textOf(afterDeletion.events)).toMatch(/TEAL/)
    expect(textOf(afterDeletion.events)).toMatch(/WOMBAT/)
    expect(textOf(afterDeletion.events)).not.toMatch(/PELICAN|CRIMSON|OSPREY/i)
    expect(live.entryCount(target.sessionId)).toBe(kept)

    await live.done()
  }, 600_000)

  it('reaches a Reply before a Compaction in a session an earlier Retry rewound', async () => {
    const live = liveDriver([])
    const first = await live.reply('My code word is TEAL.', null)

    await failedOn(live, {
      ...live.request('My pet is FERRET.', continuing(first.recorded.session)),
      model: 'claude-made-up-0',
    })
    await live.closed()

    const retried = await live.reply('My bird is OSPREY.', {
      ...first.recorded.session,
      type: 'rewind',
    })

    const third = await live.reply(
      'My color is CRIMSON.',
      continuing(retried.recorded.session)
    )

    await live.closed()
    live.setEnv({CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0.2'})

    const padded = await live.reply(
      `Ignore this message. ${PADDING}`,
      continuing(third.recorded.session)
    )

    const compacting = await live.reply(
      'Reply with the single word OK.',
      continuing(padded.recorded.session)
    )

    expect(compacting.events).toContainEqual(
      expect.objectContaining({type: 'CONTEXT_COMPACTED'})
    )

    await live.closed()
    live.setEnv({})

    const reached = await live.reply(RECALL, reaching(retried.recorded.session))

    expect(textOf(reached.events)).toMatch(/TEAL/)
    expect(textOf(reached.events)).toMatch(/OSPREY/)
    expect(textOf(reached.events)).not.toMatch(/CRIMSON|FERRET/i)

    await live.done()
  }, 600_000)

  it('gets a Reply to the next message after a Prompt too long for the Model, from the last Reply before it', async () => {
    const live = liveDriver([])
    const first = await live.reply('My code word is TEAL.', null)

    const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(
      60_000
    )

    const tooLong = await failedOn(
      live,
      live.request(
        `${filler}My ship is PELICAN.`,
        continuing(first.recorded.session)
      )
    )

    expect(tooLong.at(-1)).toMatchObject({failure: {code: 'too-long'}})
    expect(tooLong).toContainEqual(
      expect.objectContaining({
        type: 'CONTEXT_COMPACTED',
        sessionId: first.recorded.session.sessionId,
        boundaryId: expect.stringMatching(/^[\da-f-]{36}$/),
      })
    )

    const next = await live.reply(
      'My bird is OSPREY.',
      reaching(first.recorded.session)
    )

    await live.closed()

    const after = await live.reply(RECALL, continuing(next.recorded.session))

    expect(textOf(after.events)).toMatch(/TEAL/)
    expect(textOf(after.events)).toMatch(/OSPREY/)
    expect(textOf(after.events)).not.toMatch(/PELICAN/i)

    await live.done()
  }, 600_000)

  it('still serves the whole session to reach a Reply after its Compaction', async () => {
    const live = liveDriver([])
    const {third} = await compactedThread(live)

    const branch = await live.reply(
      RECALL,
      continuing(third.recorded.session, true)
    )

    expect(branch.recorded.session.sessionId).not.toBe(
      third.recorded.session.sessionId
    )
    expect(textOf(branch.events)).toMatch(/CRIMSON/)

    await live.done()
  }, 600_000)

  it('[dep:verbatim-prompts] delivers a Prompt that starts with a claude command to the AI as written, with no Compaction, and goes on from its Reply', async () => {
    const live = liveDriver([])
    const first = await live.reply('My code word is TEAL.', null)

    const answered = await live.reply(
      '/compact',
      continuing(first.recorded.session)
    )

    expect(answered.events).not.toContainEqual(
      expect.objectContaining({type: 'CONTEXT_COMPACTED'})
    )
    expect(textOf(answered.events)).not.toBe('')

    await live.closed()

    const next = await live.reply(
      'What is my code word? Just the word.',
      continuing(answered.recorded.session)
    )

    expect(textOf(next.events)).toMatch(/TEAL/)

    await live.done()
  }, 300_000)

  // windows-powershell-keeps-path covers the tools on Windows.
  it.skipIf(process.platform === 'win32')(
    '[dep:claude-tools-full-access] writes a file in the Tree’s folder and runs a command there, asking nothing, with Claude Code’s tools but no Subagents, and shows each tool call',
    async () => {
      const live = liveDriver(['tools.ndjson'])

      const tree = newTreeFolder()

      try {
        const events = await Array.fromAsync(
          live.driver.startReply({
            ...live.request(TOOLS_PROMPT, null),
            treeFolder: tree,
          })
        )

        expect(events.at(-1)).toMatchObject({status: 'complete'})
        expect(
          fs.readFileSync(path.join(tree, 'notes.txt'), 'utf8').trim()
        ).toBe('HERON')
        expect(fs.readdirSync(tree)).toEqual(['notes.txt'])

        const calls = events
          .filter(isReplyEvent)
          .reduce(foldReplyEvent, NEW_REPLY)
          .content.flatMap(part => (part.type === 'tool-call' ? [part] : []))

        expect(calls.map(call => call.toolName)).toEqual(['Write', 'Bash'])
        expect(calls.every(call => call.result?.isError === false)).toBe(true)
        expect(shownText(events)).toMatch(/HERON\s*$/)

        const lines = live.printed.map(line => JSON.parse(line))

        const [init] = lines.flatMap(line => {
          const parsed = InitLine.safeParse(line)

          return parsed.success ? [parsed.data] : []
        })

        expect(init?.tools.toSorted()).toEqual(
          [
            'Bash',
            'Read',
            'Write',
            'Edit',
            'Glob',
            'Grep',
            'NotebookEdit',
            'WebFetch',
            'WebSearch',
          ].toSorted()
        )
        expect(init?.permissionMode).toBe('bypassPermissions')
        expect(lines.filter(line => line.type === 'control_request')).toEqual(
          []
        )

        await live.done()
      } finally {
        fs.rmSync(tree, {recursive: true, force: true})
      }
    },
    300_000
  )

  it('[dep:claude-supervised-asks] under Supervised, asks about a Write in the Tree’s folder once its tool call shows, at that call, and writes the file once allowed, then asks the next Reply’s own card in the same claude', async () => {
    const live = liveDriver(['approved.ndjson'])
    const tree = newTreeFolder()

    try {
      const events = await answering(
        live.driver,
        supervised(live, SUPERVISED_WRITE, tree),
        ['allow-once']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(readIn(tree, 'notes.txt')).toBe('HERON')

      const [write] = toolCallsIn(events)
      const asked = events.findIndex(e => e.type === 'APPROVAL_REQUESTED')

      expect(events[asked]).toMatchObject({
        toolCallId: write?.toolCallId,
        action: {
          kind: 'edit',
          paths: [path.join(tree, 'notes.txt')],
          inTreeFiles: true,
        },
      })
      expect(
        events.findLastIndex(
          event =>
            event.type === 'TOOL_CALL_ARGS' &&
            event.toolCallId === write?.toolCallId
        )
      ).toBeLessThan(asked)
      expect(approvalsIn(events).map(event => event.type)).toEqual([
        'APPROVAL_REQUESTED',
        'APPROVAL_RESOLVED',
      ])
      expect(write?.result?.isError).toBe(false)

      const next = {
        ...supervised(live, SECOND_WRITE, tree),
        session: continuing(recordedIn(events).session),
      }

      const again = await answering(live.driver, next, ['allow-once'])

      expect(again.at(-1)).toMatchObject({status: 'complete'})
      expect(readIn(tree, 'more.txt')).toBe('OSPREY')
      expect(approvalsIn(again)[0]).toMatchObject({replyId: next.replyId})
      expect(live.queries).toHaveLength(1)

      await live.done()
    } finally {
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-supervised-asks] under Supervised, asks once for two Writes in the Tree’s files after Always allow, and not at all in a Reply that carries the grant, though claude asks the app each time', async () => {
    const live = liveDriver(['always-allowed.ndjson'])
    const tree = newTreeFolder()

    try {
      const events = await answering(
        live.driver,
        supervised(live, TWO_WRITES, tree),
        ['always-allow']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect([readIn(tree, 'a.txt'), readIn(tree, 'b.txt')]).toEqual([
        'ONE',
        'TWO',
      ])
      expect(
        toolCallsIn(events).filter(call => call.toolName === 'Write')
      ).toHaveLength(2)
      expect(approvalsIn(events).map(event => event.type)).toEqual([
        'APPROVAL_REQUESTED',
        'APPROVAL_RESOLVED',
      ])
      expect(
        controlRequestsIn(live).filter(type => type === 'can_use_tool')
      ).toHaveLength(2)

      await live.done()

      const granted = liveDriver(['granted.ndjson'])

      const next = await answering(
        granted.driver,
        {
          ...supervised(granted, GRANTED_WRITE, tree),
          grants: [{kind: 'edits-in-tree'}],
        },
        []
      )

      expect(next.at(-1)).toMatchObject({status: 'complete'})
      expect(readIn(tree, 'c.txt')).toBe('THREE')
      expect(approvalsIn(next)).toEqual([])
      expect(controlRequestsIn(granted)).toContain('can_use_tool')

      await granted.done()
    } finally {
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-supervised-asks] under Supervised, leaves a denied Write undone and the Reply goes on', async () => {
    const live = liveDriver(['denied.ndjson'])
    const tree = newTreeFolder()

    try {
      const events = await answering(
        live.driver,
        supervised(live, SUPERVISED_WRITE, tree),
        ['deny']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(fs.readdirSync(tree)).toEqual([])
      expect(toolCallsIn(events)[0]?.result?.isError).toBe(true)
      expect(approvalsIn(events).at(-1)).toMatchObject({answer: 'deny'})
      expect(shownText(events)).not.toBe('')

      await live.done()
    } finally {
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-supervised-asks] under Supervised, a Stop while a card waits ends the Reply stopped, and the Write never happens', async () => {
    const live = liveDriver(['stopped-asking.ndjson'])
    const tree = newTreeFolder()
    const request = supervised(live, SUPERVISED_WRITE, tree)
    const events: Streamed[] = []

    try {
      for await (const event of live.driver.startReply(request)) {
        events.push(event)

        if (event.type === 'APPROVAL_REQUESTED') {
          await live.driver.stop(request.replyId)
        }
      }

      expect(events.at(-1)).toMatchObject({status: 'stopped'})
      expect(approvalsIn(events).map(event => event.type)).toEqual([
        'APPROVAL_REQUESTED',
      ])
      expect(fs.readdirSync(tree)).toEqual([])

      await live.done()
    } finally {
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-supervised-asks] under Supervised, reads a file outside the Tree’s folder without asking, which claude asks about without the hook', async () => {
    const live = liveDriver(['read-outside.ndjson'])
    const tree = newTreeFolder()
    const outside = newTreeFolder()
    const secret = path.join(outside, 'secret.txt')
    fs.writeFileSync(secret, 'OSPREY\n')
    const prompt = `Read ${secret} with your Read tool and reply with only what it holds.`

    try {
      const events = await answering(
        live.driver,
        supervised(live, prompt, tree),
        []
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(toolCallsIn(events).map(call => call.toolName)).toEqual(['Read'])
      expect(shownText(events)).toMatch(/OSPREY/)
      expect(approvalsIn(events)).toEqual([])
      expect(controlRequestsIn(live)).toEqual(['hook_callback'])

      await live.done()

      const asked: string[] = []

      await Array.fromAsync(
        query({
          prompt,
          options: {
            pathToClaudeCodeExecutable: program,
            env: claudeReplyEnvironment(process.env, configDir),
            cwd: tree,
            settingSources: [],
            tools: ['Read'],
            permissionMode: 'default',
            model: 'haiku',
            canUseTool: async (toolName, input) => {
              asked.push(toolName)

              return {behavior: 'allow', updatedInput: input}
            },
          },
        })
      )

      expect(asked).toEqual(['Read'])
    } finally {
      fs.rmSync(tree, {recursive: true, force: true})
      fs.rmSync(outside, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-sandbox] under Supervised, asks before a command, then runs it inside the Sandbox, where it writes in the Tree’s folder though every other Tree is hidden', async () => {
    const live = liveDriver(['sandboxed.ndjson'])
    const trees = sandboxedTrees()

    try {
      const events = await answering(
        live.driver,
        inSandbox(live, SANDBOXED_COMMAND, trees),
        ['allow-once']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(readIn(trees.tree, 'notes.txt')).toBe('HERON')

      const [card] = approvalsIn(events)
      const [bash] = toolCallsIn(events)

      expect(card).toMatchObject({
        type: 'APPROVAL_REQUESTED',
        toolCallId: bash?.toolCallId,
        action: {kind: 'command', command: expect.stringContaining('HERON')},
      })
      expect(
        card?.type === 'APPROVAL_REQUESTED' && card.action
      ).not.toHaveProperty('outsideSandbox')
      expect(bash?.result?.content).toMatch(/^1\s*$/m)

      await live.done()
    } finally {
      fs.rmSync(trees.root, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-sandbox] under Supervised, a write outside the Tree’s folder fails inside the Sandbox, and its retry outside asks on a card of its own', async () => {
    const live = liveDriver(['left-sandbox.ndjson'])
    const trees = sandboxedTrees()

    const outside = path.join(
      '/Library/Caches',
      `uz-sandbox-${crypto.randomUUID()}.txt`
    )

    try {
      const events = await answering(
        live.driver,
        inSandbox(live, leavingPrompt(outside), trees),
        ['allow-once', 'deny']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(fs.existsSync(outside)).toBe(false)

      const asked = approvalsIn(events).flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event.action] : []
      )

      const [inside, retried] = toolCallsIn(events)

      expect(asked).toEqual([
        {kind: 'command', command: expect.stringContaining(outside)},
        {
          kind: 'command',
          command: expect.stringContaining(outside),
          outsideSandbox: true,
        },
      ])
      expect(inside?.result?.content).toMatch(/Operation not permitted/)
      expect(retried?.result?.isError).toBe(true)

      await live.done()
    } finally {
      fs.rmSync(trees.root, {recursive: true, force: true})
      fs.rmSync(outside, {force: true})
    }
  }, 300_000)

  it('[dep:claude-sandbox] under Supervised, a connection from inside the Sandbox asks on a card naming its host, and goes through once allowed', async () => {
    const live = liveDriver(['network.ndjson'])
    const trees = sandboxedTrees()

    try {
      const events = await answering(
        live.driver,
        inSandbox(live, NETWORK_COMMAND, trees),
        ['allow-once', 'always-allow']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})

      const asked = approvalsIn(events).flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event.action] : []
      )

      expect(asked).toEqual([
        {kind: 'command', command: expect.stringContaining('curl')},
        {kind: 'host', host: 'example.com'},
      ])
      expect(toolCallsIn(events)[0]?.result?.content).toMatch(/200/)

      await live.done()
    } finally {
      fs.rmSync(trees.root, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-sandbox] under Supervised, refuses with no card a Read of a hidden folder and a Read of another Tree, and the Sandbox refuses an allowed command reading either', async () => {
    const live = liveDriver(['read-denied.ndjson'])
    const trees = sandboxedTrees()
    const hidden = newTreeFolder()
    const secret = path.join(hidden, 'secret.txt')
    const otherSecret = path.join(trees.other, 'secret.txt')
    fs.writeFileSync(secret, 'OSPREY\n')
    fs.writeFileSync(otherSecret, 'PLOVER\n')
    // `claude` itself refuses a command that names a path under a Read deny
    // rule, so only a script brings the read to the Sandbox.
    fs.writeFileSync(path.join(trees.tree, 'read.sh'), `cat ${secret}\n`)

    try {
      const events = await answering(
        live.driver,
        {
          ...inSandbox(live, readingPrompt(secret, otherSecret), trees),
          hiddenFolders: [configDir, hidden],
        },
        ['allow-once', 'allow-once']
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})

      const calls = toolCallsIn(events)
      const [read, otherRead, other, hiddenFile] = calls

      const asked = approvalsIn(events).flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event] : []
      )

      expect(calls.map(call => call.toolName)).toEqual([
        'Read',
        'Read',
        'Bash',
        'Bash',
      ])
      expect(asked).toEqual([
        expect.objectContaining({
          toolCallId: other?.toolCallId,
          action: {kind: 'command', command: `cat ${otherSecret}`},
        }),
        expect.objectContaining({
          toolCallId: hiddenFile?.toolCallId,
          action: {kind: 'command', command: 'sh read.sh'},
        }),
      ])
      expect(read?.result?.isError).toBe(true)
      expect(otherRead?.result?.isError).toBe(true)
      expect(other?.result?.content).toMatch(
        /secret\.txt: Operation not permitted/
      )
      expect(hiddenFile?.result?.content).toMatch(
        /secret\.txt: Operation not permitted/
      )
      expect(shownText(events)).not.toMatch(/OSPREY|PLOVER/)

      await live.done()
    } finally {
      fs.rmSync(trees.root, {recursive: true, force: true})
      fs.rmSync(hidden, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-sandbox] the ask rule brings a command’s retry outside the Sandbox to canUseTool past a Bash allow rule, which lets it through silently alone', async () => {
    const trees = sandboxedTrees()

    const prompt =
      'Run exactly this command with Bash, with dangerouslyDisableSandbox set to true: `echo PLOVER`. Then reply with only what it printed.'

    const {sandbox, permissions} = sandboxSettings(
      {
        ...liveDriver([]).request(prompt, null),
        treeFolder: trees.tree,
        treesFolder: trees.root,
        permissionMode: 'supervised',
      },
      'darwin'
    )

    async function retriesAsked(ask: string[]) {
      const asked: unknown[] = []

      await Array.fromAsync(
        query({
          prompt,
          options: {
            pathToClaudeCodeExecutable: program,
            env: claudeReplyEnvironment(process.env, configDir),
            cwd: trees.tree,
            settingSources: [],
            tools: ['Bash'],
            permissionMode: 'default',
            model: 'haiku',
            ...(sandbox && {sandbox}),
            settings: {permissions: {...permissions, ask}},
            allowedTools: ['Bash(echo:*)'],
            canUseTool: async (toolName, input) => {
              if (toolName === 'Bash')
                asked.push(input.dangerouslyDisableSandbox)

              return {behavior: 'allow', updatedInput: input}
            },
          },
        })
      )

      return asked
    }

    try {
      expect(await retriesAsked(permissions?.ask ?? [])).toContain(true)
      expect(await retriesAsked([])).toEqual([])
    } finally {
      fs.rmSync(trees.root, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:claude-resume-moved-folder] resumes a session from the app’s copy alone in a Tree folder other than the one it started in, and works there', async () => {
    const live = liveDriver([])
    const first = await live.reply('Remember the codeword ZANZIBAR.', null)

    await live.closed()
    forgetTranscript(first.recorded.session.sessionId)

    const moved = newTreeFolder()

    try {
      const events = await Array.fromAsync(
        live.driver.startReply({
          ...live.request(
            'Run `pwd` with Bash, then reply with the codeword and what it printed, on one line.',
            continuing(first.recorded.session)
          ),
          treeFolder: moved,
        })
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(recordedIn(events).session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(events.map(event => event.type)).not.toContain('SESSION_REBUILT')
      expect(shownText(events)).toMatch(/ZANZIBAR/)
      expect(shownText(events)).toContain(moved)

      await live.done()
    } finally {
      fs.rmSync(moved, {recursive: true, force: true})
    }
  }, 300_000)

  it.runIf(process.platform === 'darwin')(
    '[dep:developer-dir-reaches-commands] runs the xcrun of the developer folder in the host’s environment for a stub in /usr/bin that a command names',
    async () => {
      const marker = `uz-xcrun-${crypto.randomUUID()}`
      const developerDir = markedDeveloperFolder(marker)

      const live = liveDriver(
        [],
        {},
        {},
        {
          ...process.env,
          DEVELOPER_DIR: developerDir,
        }
      )

      try {
        const {events} = await live.reply(
          'Run `/usr/bin/git --version` with Bash, then reply with exactly what it printed.',
          null
        )

        expect(
          toolCallsIn(events).map(call => call.result?.content.trim())
        ).toContain(`${marker} git --version`)

        await live.done()
      } finally {
        fs.rmSync(developerDir, {recursive: true, force: true})
      }
    },
    300_000
  )

  // The probe is a shell script.
  it.skipIf(process.platform === 'win32')(
    '[dep:claude-keeps-path] runs a program by name from a folder added last to the PATH claude starts with, where it is still last',
    async () => {
      const marker = `uz-path-${crypto.randomUUID()}`
      const folder = markedPathFolder(marker)
      const live = liveDriver([], {}, {}, withGitLast(process.env, folder))

      try {
        const {events} = await live.reply(
          `Run \`${PATH_PROBE}\` with Bash, then reply with exactly what it printed.`,
          null
        )

        expect(
          toolCallsIn(events).map(call => call.result?.content.trim())
        ).toContain(`${marker} ${folder}`)

        await live.done()
      } finally {
        fs.rmSync(folder, {recursive: true, force: true})
      }
    },
    300_000
  )

  it('[dep:claude-prompt-fresh] applies a changed System prompt to the session it resumes', async () => {
    const live = liveDriver([])

    async function replyUnder(
      systemPrompt: string,
      session: ReplyRequest['session']
    ) {
      const events = await Array.fromAsync(
        live.driver.startReply({
          ...live.request('Say hi.', session),
          systemPrompt,
        })
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})

      return {events, recorded: recordedIn(events)}
    }

    const first = await replyUnder(
      'End every reply with the word KIWI in capitals.',
      null
    )

    expect(shownText(first.events)).toMatch(/KIWI\W*$/)

    await live.closed()

    const second = await replyUnder(
      'End every reply with the word MANGO in capitals.',
      continuing(first.recorded.session)
    )

    expect(second.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )
    expect(shownText(second.events)).toMatch(/MANGO\W*$/)

    await live.done()
  }, 300_000)

  it('[dep:claude-tool-switches] offers the web, the account’s connectors and the built-in Skills only as the Tools panel says, in the session it resumes, and drops the connectors once their switch goes off again', async () => {
    const live = liveDriver([])

    const first = await live.reply('Say hi.', null)

    async function resumeWith(
      session: SessionRef,
      tools: ReplyRequest['tools']
    ) {
      const events = await Array.fromAsync(
        live.driver.startReply({
          ...live.request('Say hi.', continuing(session)),
          tools,
        })
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(recordedIn(events).session.sessionId).toBe(
        first.recorded.session.sessionId
      )

      return events
    }

    expect(await live.queries[0]?.mcpServerStatus()).toEqual([])

    await live.closed()

    const second = await resumeWith(first.recorded.session, {
      ...DEFAULT_TREE_TOOLS,
      webSearch: false,
      claudeConnectors: true,
      claudeBuiltInSkills: true,
    })

    const inits = live.printed.flatMap(line => {
      const parsed = InitLine.safeParse(JSON.parse(line))

      return parsed.success ? [parsed.data] : []
    })

    expect(inits).toHaveLength(2)

    const [before, after] = inits

    expect(before?.tools).toEqual(
      expect.arrayContaining(['WebFetch', 'WebSearch'])
    )
    expect(before?.tools).not.toContain('Skill')
    expect(after?.tools).not.toContain('WebFetch')
    expect(after?.tools).not.toContain('WebSearch')
    expect(after?.tools).toContain('Skill')
    // `claude` lists the connectors by the end of a Reply, so the reads after
    // Replies 1 and 3 are fair. Only an account with a connector has any: the
    // maintainer's has some.
    expect((await live.queries[1]?.mcpServerStatus())?.length).toBeGreaterThan(
      0
    )

    await live.closed()

    await resumeWith(recordedIn(second).session, {
      ...DEFAULT_TREE_TOOLS,
      webSearch: false,
      claudeConnectors: false,
      claudeBuiltInSkills: true,
    })

    expect(await live.queries[2]?.mcpServerStatus()).toEqual([])

    await live.done()
  }, 300_000)

  it('[dep:claude-one-shot-no-tools] runs a one-shot with no tools at all', async () => {
    const inits: unknown[] = []

    const answer = await runClaudeOneShot(
      {
        query: params => {
          const running = query(params)

          async function* watched() {
            for await (const message of running) {
              if (message.type === 'system' && message.subtype === 'init') {
                inits.push(message.tools)
              }

              yield message
            }
          }

          return Object.assign(watched(), {close: () => running.close()})
        },
        env: process.env,
      },
      {
        model: 'haiku',
        prompt:
          'Run `pwd`, then reply with what it printed, or NONE if you can’t.',
        vendorProgram: {
          program: {
            path: program,
            build: {url: 'https://x.test/', sha256: '', size: 0},
          },
          configDir,
        },
      },
      new AbortController().signal
    )

    expect(inits).toEqual([[]])
    expect(answer).not.toContain(configDir)
  }, 120_000)

  it('[dep:synthetic-model-name] marks the message it makes up for a failed Reply by the Model name <synthetic>, with no isSynthetic flag', async () => {
    const live = liveDriver([])

    await failedOn(live, {
      ...live.request('Reply with the single word TEAL.', null),
      model: 'claude-made-up-0',
    })

    const madeUp = linesOf(live.printed).filter(
      line => line.type === 'assistant' && line.message?.model === '<synthetic>'
    )

    expect(madeUp.length).toBeGreaterThan(0)
    expect(madeUp.filter(line => 'isSynthetic' in line)).toEqual([])

    await live.done()
  }, 180_000)

  it('[dep:stream-event-order] [dep:prompt-stored-under-app-uuid] [dep:claude-heard-within-a-minute] shows a Reply’s text once, stores the Prompt under the id the app gave it, and marks that id completed after the result', async () => {
    const live = liveDriver([])
    const request = live.request('Reply with the single word TEAL.', null)
    const events = await Array.fromAsync(live.driver.startReply(request))

    expect(events.at(-1)).toMatchObject({status: 'complete'})
    expect(shownText(events).trim()).toMatch(/^TEAL\.?$/)

    const {sessionId} = recordedIn(events).session

    expect(live.entriesOf(sessionId)).toContainEqual(
      expect.objectContaining({type: 'user', uuid: request.prompt.messageId})
    )
    await expect
      .poll(() => {
        const lines = linesOf(live.printed)
        const result = lines.findIndex(line => line.type === 'result')

        return (
          result >= 0 &&
          lines
            .slice(result + 1)
            .some(
              line =>
                line.type === 'command_lifecycle' &&
                line.state === 'completed' &&
                line.command_uuid === request.prompt.messageId
            )
        )
      })
      .toBe(true)

    await live.done()
  }, 180_000)

  it('[dep:claude-retry-watchdog] [dep:claude-api-retry] [dep:stream-event-order] waits out connections refused mid-Reply for longer than claude’s default retries, saying it is reconnecting, then completes and shows the message it started over once, as the session holds it', async () => {
    const proxy = await startProxy()
    const live = liveDriver([], {HTTPS_PROXY: proxy.url})
    const events: Streamed[] = []
    let deltas = 0

    try {
      for await (const event of live.driver.startReply(
        live.request(
          'Make up a three-word ship name, put it on the first line, then write the numbers 1 to 1000, one per line.',
          null
        )
      )) {
        events.push(event)

        // claude's default 10 retries give up after 3 to 5 minutes.
        if (event.type === 'TEXT_DELTA' && ++deltas === 12) {
          proxy.refuseFor(6 * 60_000)
        }
      }

      expect(events.at(-1)).toMatchObject({status: 'complete'})

      const lines = linesOf(live.printed)
      const retries = lines.filter(line => line.subtype === 'api_retry')

      expect(
        Math.max(...retries.map(line => line.attempt ?? 0))
      ).toBeGreaterThan(10)

      const limits = retries.map(line => line.max_retries ?? 0)

      expect(Math.max(...limits)).toBeGreaterThanOrEqual(300)
      expect(events.some(event => event.type === 'RECONNECTING')).toBe(true)
      expect(
        lines.filter(
          line =>
            line.event?.type === 'message_stop' &&
            line.abandoned_blocks !== undefined
        ).length
      ).toBeGreaterThan(0)

      const saved = live
        .entriesOf(recordedIn(events).session.sessionId)
        .map(entry => SavedEntry.parse(entry))
        .flatMap(({type, message}) =>
          type === 'assistant' && Array.isArray(message?.content)
            ? message.content.flatMap(part => part.text ?? [])
            : []
        )
        .join('')

      expect(saved).not.toBe('')
      expect(shownText(events)).toBe(saved)

      await live.done()
    } finally {
      proxy.close()
    }
  }, 900_000)

  it('[dep:claude-retry-watchdog] stops a Reply in claude’s wait within one attempt, while connections are still refused, then goes on from it once they are let through', async () => {
    const proxy = await startProxy()
    const live = liveDriver([], {HTTPS_PROXY: proxy.url})

    try {
      const first = await live.reply('My ship is PELICAN.', null)

      const counting = live.request(
        'Write the numbers 1 to 1000, one per line.',
        continuing(first.recorded.session)
      )

      const events: Streamed[] = []
      let deltas = 0
      let stopping = false

      for await (const event of live.driver.startReply(counting)) {
        events.push(event)

        // Longer than the test runs, so only Stop can end the wait.
        if (event.type === 'TEXT_DELTA' && ++deltas === 12) {
          proxy.refuseFor(30 * 60_000)
        }

        if (
          event.type === 'RECONNECTING' &&
          !stopping &&
          waitsWithinAnAttempt(live.printed)
        ) {
          stopping = true
          await live.driver.stop(counting.replyId)
        }
      }

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'stopped',
      })

      proxy.letThrough()

      // As main does for a stopped Reply never saved.
      const above =
        events.find(
          (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
        )?.session ?? first.recorded.session

      const asked = await live.reply(
        'What is my ship called? Just the name.',
        continuing(above)
      )

      expect(asked.recorded.session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(textOf(asked.events)).toMatch(/PELICAN/)

      await live.done()
    } finally {
      proxy.close()
    }
  }, 300_000)

  it('[dep:claude-watchdog-usage-limit] fails a Reply at a usage limit at once, as it does without the watchdog', async () => {
    const api = await startStandInApi()
    const live = liveDriver([], {ANTHROPIC_BASE_URL: api.url})

    async function limited() {
      const events = await failedOn(live, live.request('Say hi.', null))
      await live.closed()

      return failureIn(events)
    }

    try {
      const watched = await limited()

      expect(
        linesOf(live.printed).filter(line => line.subtype === 'api_retry')
      ).toEqual([])

      live.dropEnv(
        Object.keys(claudeReplyEnvironment({}, configDir)).filter(
          name => !(name in claudeEnvironment({}, configDir))
        )
      )

      expect(await limited()).toEqual(watched)

      await live.done()
    } finally {
      api.close()
    }
  }, 120_000)

  it('[dep:claude-heard-within-a-minute] hears claude’s init within 10 s of a Prompt sent with connections refused from the start', async () => {
    const proxy = await startProxy()
    proxy.refuseFor(30 * 60_000)
    const live = liveDriver([], {HTTPS_PROXY: proxy.url})
    const request = live.request('Say hi.', null)

    try {
      const sent = performance.now()
      const replying = Array.fromAsync(live.driver.startReply(request))

      await expect
        .poll(() =>
          linesOf(live.printed).some(
            line => line.type === 'system' && line.subtype === 'init'
          )
        )
        .toBe(true)
      expect(performance.now() - sent).toBeLessThan(10_000)
      await live.driver.stop(request.replyId)

      expect((await replying).at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'stopped',
      })

      await live.done()
    } finally {
      proxy.close()
    }
  }, 60_000)

  it('[dep:claude-api-retry] reports claude’s retry of a 429 throttle as busy, and Stop ends the Reply in that wait', async () => {
    const api = await startStandInApi('throttle')
    const live = liveDriver([], {ANTHROPIC_BASE_URL: api.url})
    const request = live.request('Say hi.', null)
    const events: Streamed[] = []
    let stopping = false

    try {
      for await (const event of live.driver.startReply(request)) {
        events.push(event)

        if (event.type === 'RECONNECTING' && !stopping) {
          stopping = true
          await live.driver.stop(request.replyId)
        }
      }

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'stopped',
      })
      expect(events.find(event => event.type === 'RECONNECTING')).toMatchObject(
        {busy: true}
      )
      expect(
        linesOf(live.printed).find(line => line.subtype === 'api_retry')
      ).toMatchObject({error_status: 429, error: 'rate_limit'})

      await live.done()
    } finally {
      api.close()
    }
  }, 120_000)

  it('[dep:claude-failure-fields] fails a Reply as connection-lost once claude gives up on refused connections, both in a Compaction and in a new session past a lowered retry limit', async () => {
    const proxy = await startProxy()
    const refused = {HTTPS_PROXY: proxy.url, CLAUDE_CODE_MAX_RETRIES: '2'}
    const live = liveDriver([], refused)

    try {
      const {failed} = await failedCompaction(live, refused, () => {
        proxy.refuseFor(30 * 60_000)
      })

      expect(failed).toMatchObject({
        // Failed by the refused connection, not on its own (`too_few_groups`).
        compact_error: expect.stringContaining('ECONNRESET'),
      })

      await live.closed()
      live.setEnv(refused)
      const sending = live.printed.length
      const lost = await failedOn(live, live.request('Say hi.', null))
      const lines = linesOf(live.printed.slice(sending))

      expect(failureIn(lost)).toMatchObject({code: 'connection-lost'})
      expect(
        lines.findLast(line => line.subtype === 'api_retry')
      ).toMatchObject({error_status: null})
      expect(lines.find(line => line.type === 'result')).toMatchObject({
        terminal_reason: 'api_error',
        api_error_status: null,
      })

      await live.done()
    } finally {
      proxy.close()
    }
  }, 300_000)

  it('[dep:claude-failure-fields] fails a Reply as connection-lost when the stand-in API answers a Compaction’s summary request with a 500', async () => {
    const api = await startStandInApi('forward')
    const through = {ANTHROPIC_BASE_URL: api.url, CLAUDE_CODE_MAX_RETRIES: '2'}
    const live = liveDriver([], through)

    try {
      const {failed, result} = await failedCompaction(live, through, () => {
        api.answer('server-error')
      })

      expect(failed).toMatchObject({
        // Failed by the 500, not on its own (`too_few_groups`).
        compact_error: expect.stringContaining('API Error: 500'),
      })
      expect(result).toMatchObject({api_error_status: null})

      await live.done()
    } finally {
      api.close()
    }
  }, 300_000)

  it('[dep:claude-failure-fields] fails a Reply the stand-in API refuses with a rejected five-hour limit as limit-reached at its reset time, with a credit balance too low as limit-reached with none, and with a 402, a 500 or a 529 as a provider error', async () => {
    const live = liveDriver([])

    async function answeredWith(
      answer: StandInAnswer,
      env: Record<string, string> = {}
    ) {
      const api = await startStandInApi(answer)
      live.setEnv({
        ANTHROPIC_BASE_URL: api.url,
        CLAUDE_CODE_MAX_RETRIES: '2',
        ...env,
      })
      const from = live.printed.length

      try {
        const events = await failedOn(live, live.request('Say hi.', null))
        await live.closed()

        return {
          failure: failureIn(events),
          lines: linesOf(live.printed.slice(from)),
          resets: api.resets,
        }
      } finally {
        api.close()
      }
    }

    const fiveHour = await answeredWith('five-hour')

    expect(fiveHour.failure).toEqual({
      code: 'limit-reached',
      message: expect.any(String),
      resetsAt: new Date(fiveHour.resets * 1000).toISOString(),
    })
    expect(fiveHour.lines).toContainEqual(
      expect.objectContaining({
        type: 'rate_limit_event',
        rate_limit_info: expect.objectContaining({
          status: 'rejected',
          resetsAt: fiveHour.resets,
        }),
      })
    )

    const lowCredit = await answeredWith('low-credit')

    expect(lowCredit.failure).toEqual({
      code: 'limit-reached',
      message: expect.any(String),
    })
    expect(lowCredit.lines).toContainEqual(
      expect.objectContaining({type: 'assistant', error: 'billing_error'})
    )
    expect(
      lowCredit.lines.filter(line => line.type === 'rate_limit_event')
    ).toEqual([])

    const paymentRequired = await answeredWith('payment-required')

    expect(paymentRequired.failure).toMatchObject({code: 'provider-error'})

    const serverError = await answeredWith('server-error')

    expect(serverError.failure).toMatchObject({code: 'provider-error'})
    expect(
      serverError.lines.find(line => line.type === 'result')
    ).toMatchObject({api_error_status: 500})

    const overloaded = await answeredWith('overloaded', {
      CLAUDE_CODE_RETRY_WATCHDOG_MAX_WAIT_MS: '5000',
    })

    expect(overloaded.failure).toMatchObject({code: 'provider-error'})
    expect(overloaded.lines.find(line => line.type === 'result')).toMatchObject(
      {api_error_status: 529}
    )

    await live.done()
  }, 180_000)

  it('[dep:thread-replay-as-conversation] [dep:reply-labels-unwritten] takes over a Thread ChatGPT wrote, told in one user message, writes no label, and goes on from it warm', async () => {
    const live = liveDriver([])

    const fromChatgpt: Thread = [
      {
        prompt: 'Pick a color for the boat, one word.',
        attachments: [],
        reply: [{type: 'text', text: 'Teal.'}],
        label: '[Reply written by GPT-6.1 Sol]',
      },
      {
        prompt: 'And an animal to paint on it, one word.',
        attachments: [],
        reply: [{type: 'text', text: 'Otter.'}],
        label: '[Reply written by GPT-6.1 Sol]',
      },
    ]

    const taken = await Array.fromAsync(
      live.driver.startReply({
        ...live.request(
          'What color and what animal did we pick? Just the two words.',
          null
        ),
        thread: fromChatgpt,
      })
    )

    expect(taken.at(-1)).toMatchObject({status: 'complete'})
    expect(textOf(taken)).toMatch(/teal/i)
    expect(textOf(taken)).toMatch(/otter/i)
    expect(textOf(taken)).not.toMatch(/\[Reply written by/)

    const after = await live.reply(
      'Which animal was it? Just the word.',
      continuing(recordedIn(taken).session)
    )

    expect(textOf(after.events)).toMatch(/otter/i)
    expect(textOf(after.events)).not.toMatch(/\[Reply written by/)

    await live.done()
  }, 180_000)

  it('[dep:claude-attachment-blocks] reads an image and a PDF sent as base64 blocks with a Prompt, and a PDF replayed with a Thread ChatGPT wrote, opening neither from its path', async () => {
    const live = liveDriver([])
    const files = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-files-'))

    try {
      const heron = pngShowing(files, 'HERON')
      const maple = pdfSaying(files, 'The secret word is MAPLE.')

      const asked = live.request(
        'Without using any tool: what word does the attached image show, and what is the secret word in the attached PDF? Just the two words.',
        null
      )

      const sent = await Array.fromAsync(
        live.driver.startReply({
          ...asked,
          prompt: {...asked.prompt, attachments: [heron, maple]},
        })
      )

      expect(sent.at(-1)).toMatchObject({status: 'complete'})
      expect(textOf(sent)).toMatch(/heron/i)
      expect(textOf(sent)).toMatch(/maple/i)
      // Each file's path is in the Prompt too: a tool call would read it there.
      expect(toolCallsIn(sent)).toEqual([])

      const replayed = await Array.fromAsync(
        live.driver.startReply({
          ...live.request(
            'Without using any tool: what was the secret word in the PDF I sent? Just the word.',
            null
          ),
          thread: [
            {
              prompt: 'Keep this PDF in mind.',
              attachments: [maple],
              reply: [{type: 'text', text: 'Noted.'}],
              label: '[Reply written by GPT-6.1 Sol]',
            },
          ],
        })
      )

      expect(replayed.at(-1)).toMatchObject({status: 'complete'})
      expect(textOf(replayed)).toMatch(/maple/i)
      expect(toolCallsIn(replayed)).toEqual([])

      await live.done()
    } finally {
      fs.rmSync(files, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:claude-opens-attachment-path] opens a PDF it is given only the path line of with Read, which takes it as a PDF by the path’s extension', async () => {
    const live = liveDriver([])
    const files = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-files-'))

    try {
      const maple = byPathOnly(pdfSaying(files, 'The secret word is MAPLE.'))

      const asked = live.request(
        'What is the secret word in the attached PDF? Just the word.',
        null
      )

      const events = await Array.fromAsync(
        live.driver.startReply({
          ...asked,
          prompt: {...asked.prompt, attachments: [maple]},
        })
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})
      expect(shownText(events)).toMatch(/maple/i)

      const reads = toolCallsIn(events).filter(
        call => call.toolName === 'Read' && call.args.includes('note.pdf')
      )

      expect(reads.length).toBeGreaterThan(0)
      expect(reads.some(call => call.result?.isError === false)).toBe(true)

      await live.done()
    } finally {
      fs.rmSync(files, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:lost-session-refusals] rebuilds from the Thread a session it has no copy of, and one resumed at an entry off its newest chain', async () => {
    const live = liveDriver([])
    const teal = 'Reply with the single word TEAL.'
    const otter = 'Now reply with the single word OTTER.'
    const asked = 'Which words have you replied with so far? Just the words.'

    const first = await live.reply(teal, null)
    const second = await live.reply(otter, continuing(first.recorded.session))

    // A rewind to the first Reply leaves the second off the newest chain.
    await live.reply('Now reply with the single word HERON.', {
      ...first.recorded.session,
      type: 'rewind',
    })
    await live.closed()

    const thread: Thread = [
      {
        prompt: teal,
        attachments: [],
        reply: [{type: 'text', text: 'TEAL'}],
        label: null,
      },
      {
        prompt: otter,
        attachments: [],
        reply: [{type: 'text', text: 'OTTER'}],
        label: null,
      },
    ]

    const offChain = await Array.fromAsync(
      live.driver.startReply({
        ...live.request(asked, {...second.recorded.session, type: 'rewind'}),
        thread,
      })
    )

    expect(offChain.at(-1)).toMatchObject({status: 'complete'})
    expect(textOf(offChain)).toMatch(/TEAL/i)
    expect(textOf(offChain)).toMatch(/OTTER/i)
    expect(textOf(offChain)).not.toMatch(/HERON/i)
    expect(recordedIn(offChain).session.sessionId).not.toBe(
      first.recorded.session.sessionId
    )

    const unknown = crypto.randomUUID()

    const lost = await Array.fromAsync(
      live.driver.startReply({
        ...live.request(asked, {
          type: 'continue',
          sessionId: unknown,
          messageId: crypto.randomUUID(),
        }),
        thread,
      })
    )

    expect(lost.at(-1)).toMatchObject({status: 'complete'})
    expect(textOf(lost)).toMatch(/OTTER/i)
    expect(recordedIn(lost).session.sessionId).not.toBe(unknown)

    await live.done()
  }, 300_000)

  it('[dep:refused-resume-no-init] refuses to resume a session it doesn’t have without ever sending init', async () => {
    const live = liveDriver([])

    await failedOn(
      live,
      live.request('Reply with the single word TEAL.', {
        type: 'continue',
        sessionId: crypto.randomUUID(),
        messageId: crypto.randomUUID(),
      })
    )

    const lines = linesOf(live.printed)

    expect(lines).toContainEqual(
      expect.objectContaining({
        type: 'result',
        errors: [
          expect.stringMatching(/^No conversation found with session ID/),
        ],
      })
    )
    expect(
      lines.filter(line => line.type === 'system' && line.subtype === 'init')
    ).toEqual([])

    await live.done()
  }, 180_000)

  it('[dep:sdk-session-store-alpha] leaves a Reply unrecorded when the app’s copy refuses every entry', async () => {
    const live = liveDriver([], {}, {append: 'The store is full.'})

    const events = await Array.fromAsync(
      live.driver.startReply(
        live.request('Reply with the single word TEAL.', null)
      )
    )

    expect(events.at(-1)).toMatchObject({status: 'complete'})
    expect(events.filter(event => event.type === 'REPLY_RECORDED')).toEqual([])

    await live.done()
  }, 180_000)

  it('[dep:cut-with-no-target-resumes-at-newest] still resumes at the newest entry, failed attempt and all, for a cut that names nothing to keep', async () => {
    const live = liveDriver([])
    const first = await live.reply('Reply with the single word TEAL.', null)

    await failedOn(live, {
      ...live.request(
        'Remember the codeword ZANZIBAR and reply with it.',
        continuing(first.recorded.session)
      ),
      model: 'claude-made-up-0',
    })
    await live.closed()

    const after = await live.reply(
      'Quote every message I sent you before this one, word for word.',
      {
        ...first.recorded.session,
        type: 'cut',
        keepThrough: null,
        dropFrom: null,
      }
    )

    expect(textOf(after.events)).toMatch(/ZANZIBAR/i)

    await live.done()
  }, 180_000)

  it('[dep:plan-from-subscription-type] [dep:claude-exits-on-input-end] names the account’s plan, and exits by itself once its input ends', async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-exit-'))
    const watcher = path.join(folder, 'claude.mjs')
    const ended = path.join(folder, 'ended')
    fs.writeFileSync(watcher, exitWatcher(ended))

    try {
      const {account} = await readAccount({
        program: watcher,
        env: claudeEnvironment(process.env, configDir),
        cwd: configDir,
      })

      expect(fs.readFileSync(ended, 'utf8')).toBe('exited')
      expect(planOf(account.subscriptionType ?? '')).not.toBeNull()
    } finally {
      fs.rmSync(folder, {recursive: true, force: true})
    }
  }, 120_000)

  it('[dep:self-updates-off] holds every switch the app sets beside its config folder', () => {
    const binary = fs.readFileSync(program)

    const switches = Object.keys(claudeEnvironment({}, configDir)).filter(
      name => !name.startsWith('CLAUDE_')
    )

    expect(switches.length).toBeGreaterThan(0)
    expect(switches.filter(name => !binary.includes(name))).toEqual([])
  })
})
