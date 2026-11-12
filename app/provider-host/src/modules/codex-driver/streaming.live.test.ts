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

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {once} from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {createCodexDriver, spawnCodex} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

/** The Model ChatGPT's `model/list` marked as its default when recorded. */
const MODEL = 'gpt-6.1-sol'

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

function expectComplete(events: Streamed[]) {
  const last = events.at(-1)

  expect(last?.type === 'RUN_FINISHED' && last.failure).toBeFalsy()
  expect(last).toMatchObject({status: 'complete'})
}

describe.skipIf(!folder || !signedIn)('a live ChatGPT', () => {
  it('streams, continues the loaded thread, resumes from the app’s copy alone, then forks mid-Thread', async () => {
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

      const continued = await reply(
        first,
        home,
        'Now say bye in three words.',
        opened.recorded.session
      )

      expect(continued.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

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

  it('stops a Reply mid-stream and continues after it, then rewinds the loaded thread for a Retry', async () => {
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

  it('cuts an unloaded thread from a mid-Thread Prompt, dropping every Turn after it, then resumes from the app’s copy alone', async () => {
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

  it('forgets a failed Prompt once the next is sent from the Reply above it, for two failures in one thread', async () => {
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

  it('shows only the message Codex starts over after its connection drops mid-Reply', async () => {
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

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

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
})
