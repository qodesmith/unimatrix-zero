/**
 * UZ_LIVE_CODEX_PROGRAM=<userData>/vendor/chatgpt/<version>\
 * UZ_LIVE_CODEX_HOME=<userData>/providers/chatgpt\
 * bun run test:node app/provider-host/src/modules/codex-driver/streaming.live
 *
 * `UZ_RECORD=yes` rewrites `recordings/`. Record one test at a time with `-t`:
 * the ids the driver tests pin change each time.
 */
import type {
  PromptRecorded,
  ReplyRecorded,
  ReplySession,
  SessionRef,
  SignInRequest,
  StartReplyEvent,
} from '@uz/contract/host'
import type {Compaction} from '@uz/contract/settings'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {programOf} from '#modules/vendor-program/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {spawnSync} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {startAppServer} from './app-server'
import {CODEX_ARGS, codexEnvironment} from './environment'
import {createCodexDriver, spawnCodex} from './main'
import {portFree} from './port'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {NOT_ENTITLED, SIGN_IN_PORT} from './sign-in'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

/** The Model ChatGPT's `model/list` marked as its default when recorded. */
const MODEL = 'gpt-6.1-sol'

const DEFAULT_COMPACTION: Compaction = {auto: true, threshold: null}

function homeFrom(source: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
  fs.copyFileSync(path.join(source, 'auth.json'), path.join(home, 'auth.json'))

  return home
}

type Streamed = StartReplyEvent

/**
 * A CONNECT proxy that can cut every open connection, the way a dropped Wi-Fi
 * ends `codex`'s stream, while letting the reconnect through at once.
 */
async function startProxy() {
  const open = new Set<net.Socket>()
  const server = http.createServer((_request, response) => response.end())

  server.on('connect', (request, client: net.Socket) => {
    const [host = '', port = '443'] = (request.url ?? '').split(':')

    const upstream = net.connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(client)
      client.pipe(upstream)
    })

    for (const socket of [client, upstream]) {
      open.add(socket)
      socket.on('close', () => open.delete(socket))
    }

    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const {port} = z.looseObject({port: z.number()}).parse(server.address())

  return {
    url: `http://127.0.0.1:${port}`,
    cutConnections() {
      for (const socket of open) socket.resetAndDestroy()
    },
    close: () => server.close(),
  }
}

const WireLine = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z
    .looseObject({
      itemId: z.string().optional(),
      item: z.looseObject({id: z.string(), type: z.string()}).optional(),
    })
    .optional(),
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
          prompt: {text, messageId: crypto.randomUUID()},
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
          compaction: DEFAULT_COMPACTION,
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
        prompt: {text, messageId: crypto.randomUUID()},
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
        compaction: DEFAULT_COMPACTION,
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
          prompt: {text, messageId: crypto.randomUUID()},
          vendorProgram: vendorProgram(home),
          session: session && {...session, type: 'continue'},
          compaction: DEFAULT_COMPACTION,
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
          prompt: {text, messageId: crypto.randomUUID()},
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
          compaction: DEFAULT_COMPACTION,
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

  it('[dep:codex-reconnect-new-message] shows only the message Codex starts over, as a new item that leaves the first unfinished, after its connection drops mid-Reply', async () => {
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
        compaction: DEFAULT_COMPACTION,
      })) {
        events.push(event)

        if (event.type === 'TEXT_DELTA' && ++deltas === 12)
          proxy.cutConnections()
      }

      expectComplete(events)

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
          prompt: {text, messageId: crypto.randomUUID()},
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
          compaction: DEFAULT_COMPACTION,
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
    const treeId = crypto.randomUUID()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([
      path.join(RECORDINGS, 'compaction-settings.ndjson'),
    ])

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
      whenIdle: idle.whenIdle,
    })

    async function reply(
      text: string,
      session: SessionRef | null,
      threshold: number
    ) {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, messageId: crypto.randomUUID()},
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
          compaction: {auto: true, threshold},
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

      idle.pass()
      await Promise.all(exits)
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
          compaction: DEFAULT_COMPACTION,
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
          compaction: DEFAULT_COMPACTION,
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
