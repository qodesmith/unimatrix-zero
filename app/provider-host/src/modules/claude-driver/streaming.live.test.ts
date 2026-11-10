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
import type {
  ReplyRecorded,
  ReplyRequest,
  ReplySession,
  SessionRef,
  StartReplyEvent,
} from '@uz/contract/host'

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

type Streamed = StartReplyEvent

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

function liveDriver(files: string[], firstEnv: Record<string, string> = {}) {
  let addedEnv = firstEnv
  const store = fakeStore()

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
      const child = start({...options, env: {...options.env, ...addedEnv}})
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

const RECALL =
  'Name my code word, my ship, my color, my pet and my bird, in that order. Write NONE for each one I never told you.'

async function failedOn(live: Live, request: ReplyRequest) {
  const events = await Array.fromAsync(live.driver.startReply(request))

  expect(events.at(-1)).toMatchObject({type: 'RUN_FINISHED', status: 'failed'})

  return events
}

/**
 * Three Turns, compacted inside the third. The threshold is lowered only for
 * them: every later `claude` starts without it.
 */
async function compactedThread(live: Live) {
  live.setEnv({CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '0.2'})

  const padding = 'The harbor log lists no ships today. '.repeat(300)
  const first = await live.reply('My code word is TEAL.', null)

  const second = await live.reply(
    `My ship is PELICAN. Ignore the rest of this message. ${padding}`,
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
      {...stopped.session, type: 'continue'}
    )

    expect(asked.recorded.session.sessionId).toBe(stopped.session.sessionId)

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

    const padding = 'The harbor log lists no ships today. '.repeat(300)

    const first = await live.reply('My code word is TEAL.', null)

    const second = await live.reply(
      `My ship is PELICAN. Ignore the rest of this message. ${padding}`,
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

    const compacting = await Array.fromAsync(
      live.driver.startReply(
        live.request('/compact', continuing(third.recorded.session))
      )
    )

    expect(compacting).toContainEqual(
      expect.objectContaining({type: 'CONTEXT_COMPACTED'})
    )

    await live.closed()

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
})
