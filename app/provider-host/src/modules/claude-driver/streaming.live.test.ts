/**
 * Live: drives a real `claude`, signed in to a real Claude plan, so it runs
 * only when asked, on a machine where Claude was connected in the app:
 *
 * UZ_LIVE_CLAUDE_PROGRAM=<userData>/vendor/claude/<version>/claude\
 * UZ_LIVE_CLAUDE_CONFIG=<userData>/providers/claude\
 * bun run test:node app/provider-host/src/modules/claude-driver/streaming.live
 *
 * With `UZ_RECORD=yes` it also writes what `claude` and the SDK exchanged
 * into `recordings/`, which the driver tests replay.
 */
import type {ReplyRecorded, SessionRef} from '@uz/contract/host'

import {fakeStore} from '#modules/test-store/main'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {createClaudeDriver} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {projectKeyOf} from './transcripts'

const program = process.env.UZ_LIVE_CLAUDE_PROGRAM
const configDir = process.env.UZ_LIVE_CLAUDE_CONFIG

const IDLE_MS = 2000

describe.skipIf(!program || !configDir)('a live Claude', () => {
  it('streams, continues warm, then resumes from the app’s copy alone', async () => {
    if (!program || !configDir) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ({command, args, cwd, env, signal}) =>
        spawn(command, args, {cwd, env, signal, stdio: 'pipe'}),
      ['warm.ndjson', 'resumed.ndjson'].map(name => path.join(RECORDINGS, name))
    )

    const driver = createClaudeDriver({
      store: store.client,
      ...(recording ? {spawn: recorder.spawn} : {}),
      idleMs: IDLE_MS,
    })

    const treeId = crypto.randomUUID()

    async function reply(
      text: string,
      session: SessionRef | null,
      fork = false
    ) {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: 'haiku',
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text},
          vendorProgram: {
            program: {
              path: program ?? '',
              build: {url: 'https://x.test/', sha256: '', size: 0},
            },
            configDir: configDir ?? '',
          },
          session: session && {...session, fork},
        })
      )

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      expect(events.at(-1)).toMatchObject({status: 'complete'})

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, recorded}
    }

    const first = await reply('Reply with the single word TEAL.', null)

    const second = await reply(
      'Now reply with the single word OTTER.',
      first.recorded.session
    )

    expect(second.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )

    // Idle long enough to close, then without claude's own transcript.
    await new Promise(resolve => {
      setTimeout(resolve, IDLE_MS * 3)
    })
    fs.rmSync(
      path.join(
        configDir,
        'projects',
        projectKeyOf(configDir),
        `${first.recorded.session.sessionId}.jsonl`
      ),
      {force: true}
    )

    const third = await reply(
      'Which two words did you reply with? Just the words.',
      second.recorded.session
    )

    const text = third.events
      .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
      .join('')

    expect(text).toMatch(/TEAL/)
    expect(text).toMatch(/OTTER/)

    await new Promise(resolve => {
      setTimeout(resolve, IDLE_MS * 3)
    })

    if (recording) await recorder.done()
  }, 180_000)
})
