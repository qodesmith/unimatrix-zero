/**
 * Live: drives a real `claude` on a real Claude plan, so it runs only when
 * asked, on a machine where Claude was connected in the app:
 *
 * UZ_LIVE_CLAUDE_PROGRAM=<userData>/vendor/claude/<version>/claude\
 * UZ_LIVE_CLAUDE_CONFIG=<userData>/providers/claude\
 * bun run test:node app/provider-host/src/modules/claude-driver/streaming.live
 *
 * `UZ_RECORD=yes` also writes `recordings/`, which the driver tests replay;
 * run one `it` with `-t` to re-record only its files.
 */
import type {ReplyRecorded, ReplyRequest, SessionRef} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

import {createClaudeDriver, spawnClaude} from './main'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {projectKeyOf} from './transcripts'

const program = process.env.UZ_LIVE_CLAUDE_PROGRAM ?? ''
const configDir = process.env.UZ_LIVE_CLAUDE_CONFIG ?? ''
const recording = process.env.UZ_RECORD === 'yes'

type Streamed = ReplyEvent | ReplyRecorded

function textOf(events: Streamed[]) {
  return events
    .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
    .join('')
}

function recordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
  )

  if (!recorded) throw new Error('The Reply was not recorded')

  return recorded
}

function forgetTranscript(sessionId: string) {
  fs.rmSync(
    path.join(
      configDir,
      'projects',
      projectKeyOf(configDir),
      `${sessionId}.jsonl`
    ),
    {force: true}
  )
}

function liveDriver(files: string[]) {
  const recorder = createRecorder(
    ({command, args, cwd, env, signal}) =>
      spawn(command, args, {cwd, env, signal, stdio: 'pipe'}),
    files.map(name => path.join(RECORDINGS, name))
  )

  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const start = recording ? recorder.spawn : spawnClaude

  const driver = createClaudeDriver({
    store: fakeStore().client,
    spawn: options => {
      const child = start(options)
      exits.push(
        new Promise(resolve => {
          child.on('exit', resolve)
        })
      )

      return child
    },
    whenIdle: idle.whenIdle,
  })

  /** Lets idle time pass, then waits for every `claude` to exit. */
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
      prompt: {text},
      vendorProgram: {
        program: {
          path: program,
          build: {url: 'https://x.test/', sha256: '', size: 0},
        },
        configDir,
      },
      session,
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
    async done() {
      await closed()

      if (recording) await recorder.done()
    },
  }
}

function continuing(session: SessionRef, fork = false) {
  return {...session, fork, rewind: false}
}

describe.skipIf(!program || !configDir)('a live Claude', () => {
  it('streams, continues warm, resumes from the app’s copy alone, then forks mid-Thread', async () => {
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
    forgetTranscript(first.recorded.session.sessionId)

    const third = await live.reply(
      'Which two words did you reply with? Just the words.',
      continuing(second.recorded.session)
    )

    expect(textOf(third.events)).toMatch(/TEAL/)
    expect(textOf(third.events)).toMatch(/OTTER/)

    // Through the first Reply only: OTTER never happened on this Branch.
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

  it('stops a Reply mid-stream and continues warm from it, then rewinds a session to an earlier Reply', async () => {
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
    const stopped = recordedIn(events)

    const asked = await live.reply(
      'What did I ask you to do? Answer in five words.',
      {...stopped.session, fork: false, rewind: false}
    )

    expect(asked.recorded.session.sessionId).toBe(stopped.session.sessionId)

    const first = await live.reply('Reply with the single word TEAL.', null)

    await live.reply('Now reply with the single word OTTER.', {
      ...first.recorded.session,
      fork: false,
      rewind: false,
    })

    await live.closed()
    forgetTranscript(first.recorded.session.sessionId)

    const rewound = await live.reply(
      'Which word did you reply with? Just the word.',
      {...first.recorded.session, fork: false, rewind: true}
    )

    expect(rewound.recorded.session.sessionId).toBe(
      first.recorded.session.sessionId
    )
    expect(textOf(rewound.events)).toMatch(/TEAL/)
    expect(textOf(rewound.events)).not.toMatch(/OTTER/)

    await live.done()
  }, 180_000)
})
