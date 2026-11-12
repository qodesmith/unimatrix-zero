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
} from '@uz/contract/host'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {describe, expect, it} from 'vitest'
import {z} from 'zod'

import {planOf, readAccount} from './account'
import {claudeEnvironment} from './environment'
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
})

function linesOf(printed: string[]) {
  return printed.map(line => OutLine.parse(JSON.parse(line)))
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
      const child = start({...options, env: {...options.env, ...addedEnv}})
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

/**
 * Three Exchanges, compacted inside the third. The threshold is lowered only
 * for them: every later `claude` starts without it.
 */
const PADDING = 'The harbor log lists no ships today. '.repeat(300)

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

    const command = await live.reply(
      '/compact',
      continuing(first.recorded.session)
    )

    expect(command.events).not.toContainEqual(
      expect.objectContaining({type: 'CONTEXT_COMPACTED'})
    )
    expect(textOf(command.events)).not.toBe('')

    await live.closed()

    const next = await live.reply(
      'What is my code word? Just the word.',
      continuing(command.recorded.session)
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
