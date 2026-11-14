/**
 * Runs a real `claude` on a real plan, only on a machine where Claude was
 * connected in the app:
 *
 * UZ_LIVE_CLAUDE_PROGRAM=<userData>/vendor/claude/<version>/claude\
 * UZ_LIVE_CLAUDE_CONFIG=<userData>/providers/claude\
 * bun run test:node app/provider-host/src/modules/claude-driver/streaming.live
 *
 * `UZ_RECORD=yes` also writes `recordings/`, which the driver tests replay;
 * run one `it` with `-t` to re-record only its files.
 */
import type {
  ReplyRecorded,
  ReplyRequest,
  ReplySession,
  SessionRef,
  StartReplyEvent,
  Thread,
} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'

import {heldIdle} from '#modules/test-idle/main'
import {listenLocally, startProxy} from '#modules/test-proxy/main'
import {fakeStore} from '#modules/test-store/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {planOf, readAccount} from './account'
import {claudeEnvironment, claudeReplyEnvironment} from './environment'
import {createClaudeDriver, spawnClaude} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {projectKeyOf} from './transcripts'

const program = process.env.UZ_LIVE_CLAUDE_PROGRAM ?? ''
const configDir = process.env.UZ_LIVE_CLAUDE_CONFIG ?? ''
const recording = process.env.UZ_RECORD === 'yes'

type Streamed = StartReplyEvent

function textOf(events: Streamed[]) {
  return events
    .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
    .join('')
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

/**
 * True once `claude` has sent `api_retry` twice for one attempt, which the
 * watchdog does 30 s into an attempt's wait. Early attempts wait less.
 */
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
    projectKeyOf(configDir),
    `${sessionId}.jsonl`
  )
}

function forgetTranscript(sessionId: string) {
  fs.rmSync(transcriptOf(sessionId), {force: true})
}

function liveDriver(
  files: string[],
  firstEnv: Record<string, string> = {},
  refuses: Parameters<typeof fakeStore>[0] = {}
) {
  let addedEnv = firstEnv
  let droppedEnv: string[] = []
  let compactionSettings: CompactionSettings = {auto: true, threshold: null}
  const store = fakeStore(refuses)
  const printed: string[] = []

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
    whenIdle: idle.whenIdle,
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
      prompt: {text, messageId: crypto.randomUUID()},
      vendorProgram: {
        program: {
          path: program,
          build: {url: 'https://x.test/', sha256: '', size: 0},
        },
        configDir,
      },
      session,
      thread: [],
      compactionSettings,
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
    /** For each `claude` started from here on. */
    setEnv(env: Record<string, string>) {
      addedEnv = env
    },
    /** For each `claude` started from here on, even ones the driver sets. */
    dropEnv(names: string[]) {
      droppedEnv = names
    },
    /** For each Reply from here on, as main reads it from Settings. */
    setCompaction(next: CompactionSettings) {
      compactionSettings = next
    },
    printed,
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

/**
 * Runs the real `claude` and writes to `ended` whether it exited by itself or
 * was killed. The SDK runs a `.mjs` with the `node` on PATH.
 */
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

/**
 * Three Exchanges, compacted inside the third. The threshold is lowered only
 * for them: every later `claude` starts without it.
 */
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

/**
 * Stands in for the API at `ANTHROPIC_BASE_URL`: every Messages request is
 * refused with a 429, and every other request goes on to the real API. A
 * five-hour limit carries the headers the servers send with one.
 */
async function startLimitedApi(limit: 'five-hour' | 'throttle' = 'five-hour') {
  // One reset for every request, so each failure names the same time.
  const resets = String(Math.floor(Date.now() / 1000) + 2 * HOUR_IN_SECONDS)

  const limitHeaders =
    limit === 'throttle'
      ? {}
      : {
          'retry-after': String(2 * HOUR_IN_SECONDS),
          'anthropic-ratelimit-unified-status': 'rejected',
          'anthropic-ratelimit-unified-reset': resets,
          'anthropic-ratelimit-unified-representative-claim': 'five_hour',
          'anthropic-ratelimit-unified-5h-status': 'rejected',
          'anthropic-ratelimit-unified-5h-reset': resets,
          'anthropic-ratelimit-unified-5h-utilization': '1.0',
          'anthropic-ratelimit-unified-overage-status': 'rejected',
        }

  const server = http.createServer((request, response) => {
    const url = request.url ?? '/'

    if (request.method === 'POST' && url.startsWith('/v1/messages')) {
      request.resume()
      response.writeHead(429, {
        'content-type': 'application/json',
        ...limitHeaders,
      })
      response.end(
        JSON.stringify({
          type: 'error',
          error: {type: 'rate_limit_error', message: 'Rate limit exceeded'},
        })
      )

      return
    }

    void (async () => {
      const body = Buffer.concat(await Array.fromAsync(request))

      const headers = Object.fromEntries(
        Object.entries(request.headers).flatMap(([name, value]) =>
          name === 'host' || value === undefined ? [] : [[name, String(value)]]
        )
      )

      const upstream = await fetch(`https://api.anthropic.com${url}`, {
        method: request.method,
        headers,
        ...(body.length > 0 ? {body} : {}),
      })

      response.writeHead(upstream.status, Object.fromEntries(upstream.headers))
      response.end(Buffer.from(await upstream.arrayBuffer()))
    })()
  })

  return {url: await listenLocally(server), close: () => server.close()}
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

  it('[dep:stream-event-order] [dep:prompt-stored-under-app-uuid] shows a Reply’s text once, and stores the Prompt under the id the app gave it', async () => {
    const live = liveDriver([])
    const request = live.request('Reply with the single word TEAL.', null)
    const events = await Array.fromAsync(live.driver.startReply(request))

    expect(events.at(-1)).toMatchObject({status: 'complete'})
    expect(shownText(events).trim()).toMatch(/^TEAL\.?$/)

    const {sessionId} = recordedIn(events).session

    expect(live.entriesOf(sessionId)).toContainEqual(
      expect.objectContaining({type: 'user', uuid: request.prompt.messageId})
    )

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

      expect(limits.length).toBeGreaterThan(0)
      expect(Math.min(...limits)).toBeGreaterThanOrEqual(300)
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

      // As main continues a stopped Reply its Provider never saved: from the Reply above.
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
    const api = await startLimitedApi()
    const live = liveDriver([], {ANTHROPIC_BASE_URL: api.url})

    async function limited() {
      const events = await failedOn(live, live.request('Say hi.', null))
      await live.closed()

      return events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY)
        .failure
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

  it('[dep:claude-api-retry] reports claude’s retry of a 429 throttle as busy, and Stop ends the Reply in that wait', async () => {
    const api = await startLimitedApi('throttle')
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

  it('[dep:thread-replay-as-conversation] [dep:reply-labels-unwritten] takes over a Thread ChatGPT wrote, told in one user message, writes no label, and goes on from it warm', async () => {
    const live = liveDriver([])

    const fromChatgpt: Thread = [
      {
        prompt: 'Pick a color for the boat, one word.',
        reply: [{type: 'text', text: 'Teal.'}],
        label: '[Reply written by GPT-6.1 Sol]',
      },
      {
        prompt: 'And an animal to paint on it, one word.',
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
      {prompt: teal, reply: [{type: 'text', text: 'TEAL'}], label: null},
      {prompt: otter, reply: [{type: 'text', text: 'OTTER'}], label: null},
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
