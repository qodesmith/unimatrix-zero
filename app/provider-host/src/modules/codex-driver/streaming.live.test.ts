/**
 * Live: drives a real `codex app-server`, signed in to a real ChatGPT plan,
 * so it runs only when asked, on a machine where ChatGPT was connected in the
 * app:
 *
 * UZ_LIVE_CODEX_PROGRAM=<userData>/vendor/chatgpt/<version>\
 * UZ_LIVE_CODEX_HOME=<userData>/providers/chatgpt\
 * bun run test:node app/provider-host/src/modules/codex-driver/streaming.live
 *
 * It copies the sign-in into three fresh folders and runs there, so the
 * second app-server has nothing but the app's copy of the rollouts to resume
 * from, and the third nothing but that copy to fork from.
 * With `UZ_RECORD=yes` it also writes what the driver and `codex` exchanged
 * into `recordings/`, which the driver tests replay.
 */
import type {ReplyRecorded, SessionRef} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {fakeStore} from '#modules/test-store/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {describe, expect, it} from 'vitest'

import {createCodexDriver} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

const IDLE_MS = 2000

function homeFrom(source: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
  fs.copyFileSync(path.join(source, 'auth.json'), path.join(home, 'auth.json'))

  return home
}

function expectComplete(events: (ReplyEvent | ReplyRecorded)[]) {
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

    function driver() {
      return createCodexDriver({
        store: store.client,
        ...(recording ? {spawn: recorder.spawn} : {}),
        idleMs: IDLE_MS,
      })
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
          session: session && {...session, fork, rewind: false},
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

      await delay(IDLE_MS * 2)

      const resumed = await reply(
        driver(),
        otherHome,
        'What was the first thing I asked you?',
        continued.recorded.session
      )

      expect(resumed.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

      await delay(IDLE_MS * 2)

      // Through the first Reply only: the second never happened on this Branch.
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

      await delay(IDLE_MS * 2)
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)
})
