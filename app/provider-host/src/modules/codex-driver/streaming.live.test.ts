/**
 * UZ_LIVE_CODEX_PROGRAM=<userData>/vendor/chatgpt/<version>\
 * UZ_LIVE_CODEX_HOME=<userData>/providers/chatgpt\
 * bun run test:node app/provider-host/src/modules/codex-driver/streaming.live
 *
 * `UZ_RECORD=yes` rewrites `recordings/`. Record one test at a time with `-t`:
 * the ids the driver tests pin change each time.
 */
import type {SpawnCodex} from './app-server'
import type {RateLimitReachedType} from './protocol/v2/RateLimitReachedType'
import type {HostAttachment} from '@uz/contract/attachments'
import type {
  PromptRecorded,
  ReplyRecorded,
  ReplySession,
  SessionRef,
  SignInRequest,
  StartReplyEvent,
  Thread,
} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'

import {pngShowing} from '#modules/test-attachments/main'
import {heldIdle} from '#modules/test-idle/main'
import {listenLocally, startProxy} from '#modules/test-proxy/main'
import {fakeStore} from '#modules/test-store/main'
import {programOf} from '#modules/vendor-program/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {spawnSync} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {StringDecoder} from 'node:string_decoder'
import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {startAppServer} from './app-server'
import {CODEX_ARGS, codexEnvironment} from './environment'
import {createCodexDriver, spawnCodex} from './main'
import {portFree} from './port'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {NOT_ENTITLED, SIGN_IN_PORT} from './sign-in'
import {CONTEXT_COMPACTION} from './wire'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

/** The Model ChatGPT's `model/list` marked as its default when recorded. */
const MODEL = 'gpt-6.1-sol'

const CONVERSION_DIR = path.join(os.tmpdir(), 'uz-conversions')

const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  threshold: null,
}

function homeFrom(source: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
  fs.copyFileSync(path.join(source, 'auth.json'), path.join(home, 'auth.json'))

  return home
}

type Streamed = StartReplyEvent

const WireLine = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z
    .looseObject({
      itemId: z.string().optional(),
      item: z.looseObject({id: z.string(), type: z.string()}).optional(),
      willRetry: z.boolean().optional(),
    })
    .optional(),
})

const ErrorNotice = z.looseObject({
  willRetry: z.boolean(),
  error: z.looseObject({codexErrorInfo: z.unknown()}),
})

function wireLinesIn(output: Buffer[]) {
  return Buffer.concat(output)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => WireLine.parse(JSON.parse(line)))
}

function agentMessagesIn(output: Buffer[]) {
  const lines = wireLinesIn(output)

  const streamed = [
    ...new Set(
      lines.flatMap(({method, params}) =>
        method === 'item/agentMessage/delta' && params?.itemId
          ? [params.itemId]
          : []
      )
    ),
  ]

  const finished = lines.flatMap(({method, params}) =>
    method === 'item/completed' && params?.item?.type === 'agentMessage'
      ? [params.item.id]
      : []
  )

  return {streamed, finished}
}

const MANIFEST = path.resolve(
  import.meta.dirname,
  '../../../../main/src/modules/vendor-programs/dev-manifest.json'
)

const PROTOCOL = path.join(import.meta.dirname, 'protocol')

const PinnedManifest = z.looseObject({
  vendorPrograms: z.looseObject({
    codex: z.looseObject({version: z.string()}),
  }),
})

function programIn(pinned: string) {
  return programOf({
    path: pinned,
    build: {
      url: 'https://example.com/codex.tar.gz',
      sha256: '0'.repeat(64),
      size: 1,
      archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
    },
  })
}

function filesIn(root: string) {
  return new Map(
    fs
      .readdirSync(root, {recursive: true, encoding: 'utf8'})
      .filter(name => fs.statSync(path.join(root, name)).isFile())
      .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')])
  )
}

function expectComplete(events: Streamed[]) {
  const last = events.at(-1)

  expect(last?.type === 'RUN_FINISHED' && last.failure).toBeFalsy()
  expect(last).toMatchObject({status: 'complete'})
}

/** A Thread's Replies, each at the Compaction threshold given. */
function compactionReplies(program: string, home: string, spawn: SpawnCodex) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawn(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))

      return child
    },
    whenIdle: idle.whenIdle,
  })

  async function reply(
    text: string,
    session: SessionRef | null,
    threshold: CompactionSettings['threshold']
  ) {
    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        session: session && {...session, type: 'continue'},
        thread: [],
        compactionSettings: {auto: true, threshold},
        conversionDir: CONVERSION_DIR,
      })
    )

    expectComplete(events)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    if (!recorded) throw new Error('The Reply was not recorded')

    return {
      compacted: events.some(event => event.type === 'CONTEXT_COMPACTED'),
      contextSize:
        events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY)
          .contextSize ?? 0,
      session: recorded.session,
    }
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  return {reply, closed}
}

/** A Thread Claude wrote, as main hands it over. */
const FROM_CLAUDE: Thread = [
  {
    prompt: 'Pick a color for the boat, one word.',
    attachments: [],
    reply: [{type: 'text', text: 'Teal.'}],
    label: '[Reply written by Haiku 5.5]',
  },
  {
    prompt: 'And an animal to paint on it, one word.',
    attachments: [],
    reply: [{type: 'text', text: 'Otter.'}],
    label: '[Reply written by Haiku 5.5]',
  },
]

/** Replies that each hand the driver the Thread they continue. */
function threadReplies(program: string, home: string) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const output: Buffer[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawnCodex(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))
      child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

      return child
    },
    whenIdle: idle.whenIdle,
  })

  async function reply(
    text: string,
    session: ReplySession | null,
    thread: Thread,
    attachments: HostAttachment[] = []
  ) {
    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments, messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        session,
        thread,
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        conversionDir: CONVERSION_DIR,
      })
    )

    expectComplete(events)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    if (!recorded) throw new Error('The Reply was not recorded')

    const shown = events
      .filter(isReplyEvent)
      .reduce(foldReplyEvent, NEW_REPLY)
      .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
      .join('')

    return {text: shown, session: recorded.session}
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  /** A text replay opens a second thread for a Reply; injected items don't. */
  function threadsStarted() {
    return wireLinesIn(output).filter(line => line.method === 'thread/started')
      .length
  }

  return {reply, closed, threadsStarted}
}

const TurnCompleted = z.looseObject({
  turn: z.looseObject({
    error: z.looseObject({codexErrorInfo: z.unknown()}).nullable(),
  }),
})

interface CodedRepliesOptions {
  args?: string[]
  env?: NodeJS.ProcessEnv
  onLine?: (line: z.infer<typeof WireLine>) => void
}

/** Replies on one app-server, each with the codes Codex sent over it. */
function codedReplies(
  program: string,
  home: string,
  {args = [], env = process.env, onLine}: CodedRepliesOptions = {}
) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const lines: z.infer<typeof WireLine>[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawnCodex(command, options)
      const decoder = new StringDecoder('utf8')
      let partial = ''

      exits.push(once(child, 'exit').catch(() => undefined))
      child.stdout.on('data', (chunk: Buffer) => {
        const whole = (partial + decoder.write(chunk)).split('\n')
        partial = whole.pop() ?? ''

        for (const text of whole.filter(Boolean)) {
          const line = WireLine.parse(JSON.parse(text))
          lines.push(line)
          onLine?.(line)
        }
      })

      return child
    },
    commandFor: command => ({command, args}),
    env,
    whenIdle: idle.whenIdle,
  })

  async function reply(text: string, session: SessionRef | null) {
    const from = lines.length

    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        session: session && {...session, type: 'continue'},
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        conversionDir: CONVERSION_DIR,
      })
    )

    const sent = lines.slice(from)
    const last = events.at(-1)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    return {
      events,
      session: recorded?.session ?? null,
      failure: last?.type === 'RUN_FINISHED' ? last.failure : undefined,
      /** The `codexErrorInfo` of each `error` notice Codex retried after. */
      retried: sent.flatMap(({method, params}) => {
        if (method !== 'error') return []

        const notice = ErrorNotice.parse(params)

        return notice.willRetry ? [notice.error.codexErrorInfo] : []
      }),
      /** Each turn's `codexErrorInfo`, null for a turn that didn't fail. */
      turnErrors: sent.flatMap(({method, params}) =>
        method === 'turn/completed'
          ? [TurnCompleted.parse(params).turn.error?.codexErrorInfo ?? null]
          : []
      ),
    }
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  return {reply, closed}
}

type Answer = (response: http.ServerResponse) => void

function notFound(response: http.ServerResponse) {
  response.writeHead(404).end()
}

/**
 * A Model API on a local port that answers each Responses request with the
 * answer last set. Every other request gets a 404.
 */
async function startStandInApi() {
  let answer: Answer = notFound

  const api = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url?.endsWith('/responses')) {
      answer(response)

      return
    }

    notFound(response)
  })

  // Refusing the WebSocket upgrade makes Codex send its requests over HTTP.
  api.on('upgrade', (_request, socket) =>
    socket.end('HTTP/1.1 426 Upgrade Required\r\n\r\n')
  )

  const url = await listenLocally(api)

  return {
    args: [
      '-c',
      `openai_base_url="${url}/v1"`,
      '-c',
      `chatgpt_base_url="${url}/backend-api/"`,
    ],
    answerWith(next: Answer) {
      answer = next
    },
    close() {
      api.close()
    },
  }
}

/** ChatGPT's 429 at a usage limit, its five-hour window full until `resetAt`. */
function usageLimit(reachedType: RateLimitReachedType, resetAt: number) {
  return (response: http.ServerResponse) => {
    const now = Math.floor(Date.now() / 1000)

    response.writeHead(429, {
      'content-type': 'application/json',
      'x-codex-primary-used-percent': '100',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': String(resetAt),
      'x-codex-secondary-used-percent': '40',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-secondary-reset-at': String(now + 3 * 24 * 3600),
      'x-codex-rate-limit-reached-type': reachedType,
    })
    response.end(
      JSON.stringify({
        error: {
          type: 'usage_limit_reached',
          message: 'The usage limit has been reached',
          plan_type: 'plus',
          resets_at: resetAt,
          resets_in_seconds: resetAt - now,
        },
      })
    )
  }
}

/** A stream that starts and then fails with `code`. */
function streamFailed(code: string, message: string) {
  return (response: http.ServerResponse) => {
    const failed = {
      type: 'response.failed',
      response: {id: 'resp_stand_in', error: {code, message}},
    }

    response.writeHead(200, {'content-type': 'text/event-stream'})
    response.end(`event: response.failed\ndata: ${JSON.stringify(failed)}\n\n`)
  }
}

const NO_RESPONSE = {responseStreamDisconnected: {httpStatusCode: null}}

function expectRetriedWithNoResponse(retried: unknown[]) {
  expect(retried.length).toBeGreaterThan(0)
  expect(retried).toEqual(retried.map(() => NO_RESPONSE))
}

describe.skipIf(!folder || !signedIn)('a live ChatGPT', () => {
  it('[dep:codex-rollout-files] streams, continues the loaded thread, appending to one rollout under sessions/, resumes from the app’s copy alone, then forks mid-Thread', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['started.ndjson', 'resumed.ndjson', 'forked.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    function savedRollouts(session: SessionRef) {
      return [...store.filesOf('codex', session.sessionId).values()]
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null,
      fork = false
    ) {
      const events = await Array.fromAsync(
        on.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          session: session && {...session, type: fork ? 'fork' : 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, recorded}
    }

    try {
      const first = driver()
      const [home, otherHome, thirdHome] = homes as [string, string, string]
      const opened = await reply(first, home, 'Say hi in three words.', null)

      expect(opened.events.some(event => event.type === 'TEXT_DELTA')).toBe(
        true
      )

      const [rollout, ...others] = savedRollouts(opened.recorded.session)

      expect(others).toEqual([])
      expect(rollout?.path).toMatch(/^sessions\/.+\/rollout-[^/]+\.jsonl$/)

      const continued = await reply(
        first,
        home,
        'Now say bye in three words.',
        opened.recorded.session
      )

      expect(continued.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

      const [appended] = savedRollouts(continued.recorded.session)
      const before = Buffer.from(rollout?.base64 ?? '', 'base64')
      const after = Buffer.from(appended?.base64 ?? '', 'base64')

      expect(appended?.path).toBe(rollout?.path)
      expect(after.length).toBeGreaterThan(before.length)
      expect(after.subarray(0, before.length).equals(before)).toBe(true)

      await closed()

      const resumed = await reply(
        driver(),
        otherHome,
        'What was the first thing I asked you?',
        continued.recorded.session
      )

      expect(resumed.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

      await closed()

      const forked = await reply(
        driver(),
        thirdHome,
        'What was the last thing I asked you?',
        opened.recorded.session,
        true
      )

      expect(forked.recorded.session.sessionId).not.toBe(
        opened.recorded.session.sessionId
      )

      const answer = forked.events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      expect(answer).toMatch(/hi/i)
      expect(answer).not.toMatch(/bye/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-thread-revert] stops a Reply mid-stream and continues after it, then rewinds the loaded thread for a Retry', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['stopped.ndjson', 'reverted.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null,
      {rewind = false, stopAfter = Infinity} = {}
    ) {
      const replyId = crypto.randomUUID()
      const events: Streamed[] = []
      let deltas = 0

      for await (const event of on.startReply({
        treeId,
        replyId,
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: folder ?? '',
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        session: session && {
          ...session,
          type: rewind ? 'rewind' : 'continue',
        },
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        conversionDir: CONVERSION_DIR,
      })) {
        events.push(event)

        if (event.type === 'TEXT_DELTA' && ++deltas === stopAfter) {
          await on.stop(replyId)
        }
      }

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {events, recorded, answer}
    }

    try {
      const [home, otherHome] = homes as [string, string]
      const first = driver()

      const stopped = await reply(
        first,
        home,
        'Count from 1 to 300, one number per line.',
        null,
        {stopAfter: 5}
      )

      expect(stopped.events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'stopped',
      })
      expect(stopped.events.at(-2)?.type).toBe('REPLY_RECORDED')
      expect(stopped.answer).not.toMatch(/\b300\b/)

      const continued = await reply(
        first,
        home,
        'What did I ask you to do? Answer in five words.',
        stopped.recorded.session
      )

      expectComplete(continued.events)
      expect(continued.recorded.session.sessionId).toBe(
        stopped.recorded.session.sessionId
      )

      await closed()

      const second = driver()
      const hi = await reply(second, otherHome, 'Say hi in three words.', null)

      expectComplete(hi.events)

      const bye = await reply(
        second,
        otherHome,
        'Now say bye in three words.',
        hi.recorded.session
      )

      expectComplete(bye.events)

      const retried = await reply(
        second,
        otherHome,
        'What was the last thing I asked you? Just the words.',
        hi.recorded.session,
        {rewind: true}
      )

      expectComplete(retried.events)
      expect(retried.recorded.session.sessionId).toBe(
        hi.recorded.session.sessionId
      )
      expect(retried.answer).toMatch(/hi/i)
      expect(retried.answer).not.toMatch(/bye/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-thread-revert] cuts an unloaded thread from a mid-Thread Prompt, dropping every Turn after it, then resumes from the app’s copy alone', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['thanked.ndjson', 'cut.ndjson', 'cut-resumed.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    function vendorProgram(home: string): SignInRequest {
      return {
        program: {
          path: folder ?? '',
          build: {
            url: 'https://example.com/codex.tar.gz',
            sha256: '0'.repeat(64),
            size: 1,
            archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
          },
        },
        configDir: home,
      }
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null
    ) {
      const events = await Array.fromAsync(
        on.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: vendorProgram(home),
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )

      expectComplete(events)

      const prompted = events.find(
        (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
      )

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!prompted || !recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {prompted, recorded, answer}
    }

    try {
      const [home, cutHome, thirdHome] = homes as [string, string, string]
      const first = driver()
      const hi = await reply(first, home, 'Say hi in three words.', null)

      const bye = await reply(
        first,
        home,
        'Now say bye in three words.',
        hi.recorded.session
      )

      await reply(
        first,
        home,
        'Now say thanks in three words.',
        bye.recorded.session
      )

      await closed()

      const kept = hi.recorded.session

      await expect(
        driver().cutSession({
          session: {
            type: 'cut',
            ...kept,
            keepThrough: kept.messageId,
            dropFrom: bye.prompted.session.messageId,
          },
          vendorProgram: vendorProgram(cutHome),
        })
      ).resolves.toBe(true)

      await closed()

      const resumed = await reply(
        driver(),
        thirdHome,
        'What did I ask you to say? Just the words.',
        kept
      )

      expect(resumed.recorded.session.sessionId).toBe(kept.sessionId)
      expect(resumed.answer).toMatch(/hi/i)
      expect(resumed.answer).not.toMatch(/bye|thank/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-history-databases] forgets a failed Prompt once the next is sent from the Reply above it, for two failures in one thread, the second from a rollout written over the one Codex’s databases saw', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    async function startReply(
      text: string,
      model: string,
      session: ReplySession | null
    ) {
      return Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          session,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )
    }

    async function reply(text: string, session: ReplySession | null) {
      const events = await startReply(text, MODEL, session)

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {recorded, answer}
    }

    async function failed(text: string, above: SessionRef) {
      const events = await startReply(text, 'gpt-made-up-0', {
        ...above,
        type: 'continue',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: expect.anything(),
      })
    }

    const recall =
      'Quote every message I sent you before this one, word for word.'

    try {
      const first = await reply('Reply with the single word TEAL.', null)

      await failed(
        'Remember the codeword ZANZIBAR and reply with it.',
        first.recorded.session
      )

      const second = await reply(recall, {
        ...first.recorded.session,
        type: 'rewind',
      })

      expect(second.recorded.session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(second.answer).toMatch(/TEAL/)
      expect(second.answer).not.toMatch(/ZANZIBAR/i)

      await failed(
        'Remember the codeword MARMALADE and reply with it.',
        second.recorded.session
      )

      idle.pass()
      await Promise.all(exits)

      expect(
        fs
          .readdirSync(home, {recursive: true, encoding: 'utf8'})
          .some(file => file.endsWith('.sqlite'))
      ).toBe(true)

      const third = await reply(recall, {
        ...second.recorded.session,
        type: 'rewind',
      })

      expect(third.recorded.session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(third.answer).toMatch(/TEAL/)
      expect(third.answer).not.toMatch(/ZANZIBAR|MARMALADE/i)

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-reconnect-new-message] [dep:codex-retry-notice] says it is reconnecting while its connections are refused mid-Reply, then shows only the message Codex starts over, as a new item that leaves the first unfinished, once they are back', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([
      path.join(RECORDINGS, 'reconnected.ndjson'),
    ])

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    const output: Buffer[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))
        child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

        return child
      },
      env: {...process.env, HTTPS_PROXY: proxy.url},
      whenIdle: idle.whenIdle,
    })

    const events: Streamed[] = []
    let deltas = 0

    try {
      for await (const event of driver.startReply({
        treeId: crypto.randomUUID(),
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {
          text: 'Make up a three-word ship name, put it on the first line, then write the numbers 1 to 50, one per line.',
          attachments: [],
          messageId: crypto.randomUUID(),
        },
        vendorProgram: {
          program: {
            path: folder,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        session: null,
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        conversionDir: CONVERSION_DIR,
      })) {
        events.push(event)

        if (event.type === 'TEXT_DELTA' && ++deltas === 12) {
          proxy.refuseFor(20_000)
        }
      }

      expectComplete(events)
      expect(
        wireLinesIn(output).filter(
          ({method, params}) => method === 'error' && params?.willRetry
        ).length
      ).toBeGreaterThan(0)
      expect(events.some(event => event.type === 'RECONNECTING')).toBe(true)

      const lines = events
        .filter(isReplyEvent)
        .reduce(foldReplyEvent, NEW_REPLY)
        .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
        .join('')
        .split('\n')

      expect(events.some(event => event.type === 'TEXT_REPLACE')).toBe(true)
      expect(lines.filter(line => !/^\d+$/.test(line))).toHaveLength(1)
      expect(lines.slice(1)).toEqual(
        Array.from({length: 50}, (_, index) => String(index + 1))
      )

      const {streamed, finished} = agentMessagesIn(output)

      expect(streamed.length).toBeGreaterThanOrEqual(2)
      expect(finished).not.toContain(streamed[0])
      expect(finished).toContain(streamed.at(-1))

      idle.pass()
      await Promise.all(exits)
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 600_000)

  it('[dep:codex-retry-notice] [dep:codex-error-info] says it is busy while the Model’s API throttles it with a retry-after, then fails as limit-reached once Codex stops retrying', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})

    api.answerWith(response => {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '1',
      })
      response.end(
        JSON.stringify({
          error: {type: 'rate_limit_exceeded', message: 'Too many requests'},
        })
      )
    })

    try {
      const throttled = await reply('Say hi.', null)

      expect(throttled.retried).toContainEqual({
        responseStreamDisconnected: {httpStatusCode: 429},
      })
      expect(throttled.events).toContainEqual(
        expect.objectContaining({type: 'RECONNECTING', busy: true})
      )
      expect(throttled.turnErrors).toEqual([
        {responseTooManyFailedAttempts: {httpStatusCode: 429}},
      ])
      expect(throttled.events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: {code: 'limit-reached'},
      })

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails as connection-lost once every stream is reset as it flows', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)

    const {reply, closed} = codedReplies(folder, home, {
      env: {...process.env, HTTPS_PROXY: proxy.url},
    })

    try {
      const first = await reply('Reply with the single word TEAL.', null)

      expectComplete(first.events)
      proxy.resetStreams()

      const dropped = await reply(
        'Reply with the single word OTTER.',
        first.session
      )

      expectRetriedWithNoResponse(dropped.retried)
      expect(dropped.turnErrors).toEqual(['other'])
      expect(dropped.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails as connection-lost when a Compaction’s connections are refused', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)

    // Codex checks the limit as a turn starts, so the padded turn compacts in the next.
    const {reply, closed} = codedReplies(folder, home, {
      args: ['-c', 'model_auto_compact_token_limit=16000'],
      env: {...process.env, HTTPS_PROXY: proxy.url},
      onLine: ({method, params}) => {
        if (
          method === 'item/started' &&
          params?.item?.type === CONTEXT_COMPACTION
        ) {
          proxy.refuseFor(10 * 60_000)
        }
      },
    })

    const padding = 'The harbor log lists no ships today. '.repeat(400)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null
      )

      expectComplete(padded.events)

      const refused = await reply(
        'Reply with the single word OTTER.',
        padded.session
      )

      expectRetriedWithNoResponse(refused.retried)
      expect(refused.turnErrors).toEqual([
        {httpConnectionFailed: {httpStatusCode: null}},
      ])
      expect(refused.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-error-info] fails a stand-in API’s usage limit as limit-reached at the snapshot’s reset time, and its workspace out of credits and its spend cap as limit-reached with none', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})
    const resetAt = Math.floor(Date.now() / 1000) + 3600

    try {
      api.answerWith(usageLimit('rate_limit_reached', resetAt))

      const limited = await reply('Say hi.', null)

      api.answerWith(usageLimit('workspace_owner_credits_depleted', resetAt))

      const outOfCredits = await reply('Say hi.', null)

      api.answerWith(usageLimit('workspace_owner_usage_limit_reached', resetAt))

      const spendCapped = await reply('Say hi.', null)

      expect(limited.turnErrors).toEqual(['usageLimitExceeded'])
      expect(limited.failure).toMatchObject({
        code: 'limit-reached',
        resetsAt: new Date(resetAt * 1000).toISOString(),
      })
      expect(outOfCredits.turnErrors).toEqual(['usageLimitExceeded'])
      expect(outOfCredits.failure).toMatchObject({code: 'limit-reached'})
      expect(outOfCredits.failure).not.toHaveProperty('resetsAt')
      expect(spendCapped.turnErrors).toEqual(['usageLimitExceeded'])
      expect(spendCapped.failure).toMatchObject({code: 'limit-reached'})
      expect(spendCapped.failure).not.toHaveProperty('resetsAt')

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails a stand-in API’s streamed rate limit as limit-reached, and its streamed usage_limit_reached as connection-lost', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})

    try {
      api.answerWith(
        streamFailed(
          'rate_limit_exceeded',
          'Rate limit reached. Please try again in 0.2s.'
        )
      )

      const rateLimited = await reply('Say hi.', null)

      api.answerWith(
        streamFailed('usage_limit_reached', 'The usage limit has been reached')
      )

      const usageStreamed = await reply('Say hi.', null)

      expect(rateLimited.turnErrors).toEqual(['rateLimitExceeded'])
      expect(rateLimited.failure).toMatchObject({code: 'limit-reached'})
      expectRetriedWithNoResponse(usageStreamed.retried)
      expect(usageStreamed.turnErrors).toEqual(['other'])
      expect(usageStreamed.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('reports a compaction Codex makes on its own inside a turn, with the thread it compacted', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const treeId = crypto.randomUUID()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([path.join(RECORDINGS, 'compacted.ndjson')])

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      // Codex checks the limit as a turn starts, so the padded turn compacts in the next.
      commandFor: program => ({
        command: program,
        args: ['-c', 'model_auto_compact_token_limit=16000'],
      }),
      whenIdle: idle.whenIdle,
    })

    async function reply(text: string, session: SessionRef | null) {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, session: recorded.session}
    }

    const padding = 'The harbor log lists no ships today. '.repeat(400)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null
      )

      const next = await reply(
        'Reply with the single word OTTER.',
        padded.session
      )

      expect(
        padded.events.filter(event => event.type === 'CONTEXT_COMPACTED')
      ).toEqual([])
      expect(
        next.events.filter(event => event.type === 'CONTEXT_COMPACTED')
      ).toEqual([
        expect.objectContaining({
          sessionId: padded.session.sessionId,
          boundaryId: null,
        }),
      ])

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-compaction-limit] compacts a thread past the threshold set, from the next Reply on a thread already loaded', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([
      path.join(RECORDINGS, 'compaction-settings.ndjson'),
    ])

    const {reply, closed} = compactionReplies(
      folder,
      home,
      recording ? recorder.spawn : spawnCodex
    )

    const padding = 'The harbor log lists no ships today. '.repeat(800)

    try {
      // Codex checks the limit as a turn starts, so the padded turn can't compact.
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null,
        30_000
      )

      const under = await reply(
        'Reply with the single word OTTER.',
        padded.session,
        30_000
      )

      const lowered = await reply(
        'Reply with the single word HERON.',
        under.session,
        20_000
      )

      expect(under.contextSize).toBeGreaterThan(20_000)
      expect(under.contextSize).toBeLessThan(30_000)
      expect([padded.compacted, under.compacted, lowered.compacted]).toEqual([
        false,
        false,
        true,
      ])

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-compaction-limit] drops a lowered limit from the next Reply on a thread already loaded, once the threshold goes back to the default', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const {reply, closed} = compactionReplies(folder, home, spawnCodex)
    const padding = 'The harbor log lists no ships today. '.repeat(1000)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null,
        20_000
      )

      const restored = await reply(
        'Reply with the single word OTTER.',
        padded.session,
        null
      )

      expect(padded.contextSize).toBeGreaterThan(20_000)
      expect([padded.compacted, restored.compacted]).toEqual([false, false])

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-server-requests-refused] runs a shell command for the AI without sending the app one server request', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const output: Buffer[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))
        child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    try {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {
            text: 'Run `pwd` in your shell, then reply with only what it printed.',
            attachments: [],
            messageId: crypto.randomUUID(),
          },
          vendorProgram: {
            program: {
              path: folder,
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          session: null,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )

      expectComplete(events)

      const lines = wireLinesIn(output)

      expect(
        lines.some(
          ({method, params}) =>
            method === 'item/completed' &&
            params?.item?.type === 'commandExecution'
        )
      ).toBe(true)
      expect(
        lines.filter(line => line.id !== undefined && line.method !== undefined)
      ).toEqual([])

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)
})

describe.skipIf(!folder)('a live Codex nobody signed in to', () => {
  it('fails a Prompt over Codex’s text cap as too long, with both counts', async () => {
    if (!folder) return

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    try {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: '',
          // Two UTF-16 units each: Codex counts code points, not `length`.
          prompt: {
            text: '😀'.repeat(1_100_000),
            attachments: [],
            messageId: crypto.randomUUID(),
          },
          vendorProgram: {
            program: {
              path: folder,
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          session: null,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          conversionDir: CONVERSION_DIR,
        })
      )

      const last = events.at(-1)
      const failure = last?.type === 'RUN_FINISHED' ? last.failure : undefined

      expect(failure).toMatchObject({code: 'too-long', promptChars: 1_100_000})
      expect(failure?.maxPromptChars).toBeLessThan(1_100_000)
      expect(events.some(event => event.type === 'PROMPT_RECORDED')).toBe(false)

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  })

  it('[dep:codex-inject-items] [dep:lost-session-refusals] [dep:reply-labels-unwritten] takes over a Thread Claude wrote as its own history, writes no label, and rebuilds a thread it has no rollout of', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const {reply, closed, threadsStarted} = threadReplies(folder, home)
    const asked = 'What color and what animal did we pick? Just the two words.'

    try {
      const taken = await reply(asked, null, FROM_CLAUDE)

      expect(taken.text).toMatch(/teal/i)
      expect(taken.text).toMatch(/otter/i)
      expect(taken.text).not.toMatch(/\[Reply written by/)
      expect(threadsStarted()).toBe(1)

      const lost = crypto.randomUUID()

      const rebuilt = await reply(
        asked,
        {type: 'continue', sessionId: lost, messageId: crypto.randomUUID()},
        FROM_CLAUDE
      )

      expect(rebuilt.text).toMatch(/teal/i)
      expect(rebuilt.text).toMatch(/otter/i)
      expect(rebuilt.text).not.toMatch(/\[Reply written by/)
      expect(rebuilt.session.sessionId).not.toBe(lost)
      expect(threadsStarted()).toBe(2)

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-data-url-images] [dep:codex-injected-images] reads an image sent as a data URL with a Prompt, and one injected with a Thread Claude wrote', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const files = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-files-'))
    const {reply, closed, threadsStarted} = threadReplies(folder, home)

    try {
      const heron = await pngShowing(files, 'HERON')

      const sent = await reply(
        'What word does the image show? Just the word.',
        null,
        [],
        [heron]
      )

      expect(sent.text).toMatch(/heron/i)

      const fromClaude: Thread = [
        {
          prompt: 'Keep this image in mind.',
          attachments: [heron],
          reply: [{type: 'text', text: 'Noted.'}],
          label: '[Reply written by Haiku 5.5]',
        },
      ]

      const injected = await reply(
        'What word did the image I sent show? Just the word.',
        null,
        fromClaude
      )

      expect(injected.text).toMatch(/heron/i)
      // One thread for each Reply: Codex took the image, so no text replay.
      expect(threadsStarted()).toBe(2)

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(files, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-protocol-types] generates the protocol/ types committed for it', () => {
    if (!folder) return

    const {version} = PinnedManifest.parse(
      JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    ).vendorPrograms.codex

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-protocol-'))
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))

    try {
      // The standalone app-server has no generator: the full `codex` does.
      const generated = spawnSync(
        'bunx',
        [`@openai/codex@${version}`, 'app-server', 'generate-ts', '--out', out],
        {encoding: 'utf8', env: {...process.env, CODEX_HOME: home}}
      )

      expect({
        status: generated.status,
        stderr: generated.stderr,
      }).toMatchObject({
        status: 0,
      })

      const committed = filesIn(PROTOCOL)
      const fresh = filesIn(out)
      const names = new Set([...committed.keys(), ...fresh.keys()])

      expect(
        [...names].filter(name => committed.get(name) !== fresh.get(name))
      ).toEqual([])
    } finally {
      fs.rmSync(out, {recursive: true, force: true})
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:self-updates-off] holds every setting the app passes it', () => {
    if (!folder) return

    const program = programIn(folder)

    const binary = fs.readFileSync(program)

    const settings = CODEX_ARGS.filter(arg => arg !== '-c').map(
      arg => arg.split('=')[0] ?? ''
    )

    expect(settings.length).toBeGreaterThan(0)
    expect(settings.filter(name => !binary.includes(name))).toEqual([])
  })

  it('[dep:codex-sign-in-port-and-refusal] holds the refused-workspace wording the app matches, and takes the sign-in port for a sign-in', async () => {
    if (!folder) return

    const program = programIn(folder)

    expect(fs.readFileSync(program).includes(NOT_ENTITLED)).toBe(true)

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))

    const server = await startAppServer(
      spawnCodex,
      {command: program, args: CODEX_ARGS},
      {cwd: home, env: codexEnvironment(process.env, home)}
    )

    try {
      expect(
        await portFree(SIGN_IN_PORT),
        'another sign-in holds the port: close it and run again'
      ).toBe(true)

      const login = await server.request('account/login/start', {
        type: 'chatgpt',
      })

      await expect.poll(async () => portFree(SIGN_IN_PORT)).toBe(false)
      await server.request('account/login/cancel', {loginId: login.loginId})
    } finally {
      await server.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  })
})
