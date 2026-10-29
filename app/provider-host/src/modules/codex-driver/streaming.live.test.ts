/**
 * Live, against a real ChatGPT sign-in; runs only when asked:
 *
 * UZ_LIVE_CODEX_PROGRAM=<userData>/vendor/chatgpt/<version>\
 * UZ_LIVE_CODEX_HOME=<userData>/providers/chatgpt\
 * bun run test:node app/provider-host/src/modules/codex-driver/streaming.live
 *
 * `UZ_RECORD=yes` writes the `recordings/` the driver tests replay. Record one
 * test at a time with `-t`: the ids the driver tests pin change each time.
 */
import type {
  ReplyRecorded,
  SessionRef,
  StartReplyEvent,
} from '@uz/contract/host'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {once} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {createCodexDriver, spawnCodex} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

function homeFrom(source: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
  fs.copyFileSync(path.join(source, 'auth.json'), path.join(home, 'auth.json'))

  return home
}

type Streamed = StartReplyEvent

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

    /** Lets idle time pass, then waits for every `codex` to exit. */
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
          model: 'default',
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text},
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

    /** Lets idle time pass, then waits for every `codex` to exit. */
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
        model: 'default',
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text},
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
})
