import type {FakeClaudeOptions, RecordedLine} from './replay'
import type {SDKPartialAssistantMessage} from '@anthropic-ai/claude-agent-sdk'
import type {
  ReplyRecorded,
  ReplyRequest,
  ReplySession,
  SessionRef,
  StartReplyEvent,
  Thread,
} from '@uz/contract/host'
import type {Model} from '@uz/contract/providers'
import type {CompactionSettings} from '@uz/contract/settings'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {explainingLabels} from '#modules/thread-replay/main'
import {isReplyEvent} from '@uz/contract/host'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {once} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {createClaudeDriver, spawnClaude} from './main'
import {
  FakeClaudeRunSchema,
  RECORDINGS,
  RecordedLineSchema,
  fakeClaudeEnv,
  replayClaude,
} from './replay'
import {projectKeyOf} from './transcripts'

const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  threshold: null,
}

/** As `warm.ndjson`, `resumed.ndjson` and `forked.ndjson` recorded them. */
const SESSION_ID = '6b3fb527-e561-4b5c-810d-0ef9ac53978c'
const FIRST_MESSAGE = '62e0dab1-d770-4979-863e-4df4e2be3150'
const SECOND_MESSAGE = '7e7158ab-59c9-4e14-9828-54466ba8084e'
const RESUMED_MESSAGE = '54a838e7-618e-41c6-a747-d57b47a7908e'
const FORKED_SESSION_ID = '830530ec-a381-4e19-98a4-d7383b717af5'
const FORKED_MESSAGE = '1f72cfd4-d1f2-4d35-aa13-f8df39b2bdb1'

/** As `stopped.ndjson` recorded them. */
const STOPPED_SESSION_ID = '3a5d1c74-2159-4d23-a6a3-fd192b046074'
const STOPPED_MESSAGE = '8ce30d53-0856-4a14-a476-50e3b6184868'
const ASKED_MESSAGE = '2f4dc5fc-2bbc-434b-a571-f92d02cbda82'

/** As `rewound-warm.ndjson` and `rewound.ndjson` recorded them. */
const REWOUND_SESSION_ID = '0dcd3d7c-ebce-4799-8da8-bdf836d1cbf3'
const TEAL_MESSAGE = '90b7a04e-36fa-4aa1-84e8-66380ab18fe0'
const OTTER_MESSAGE = '52786f10-3dd8-4f5b-995f-c5f9c5a27a0e'
const REWOUND_MESSAGE = '18fb8495-3399-43a8-bc37-573286cfc9ed'
const MODEL = 'claude-haiku-5-5'

/** As `compacted.ndjson` recorded them. */
const COMPACTED_SESSION_ID = '471b5fd5-abf7-498b-9216-26c3ae547643'
const BOUNDARY_ENTRY = '42429c6a-0cbe-4ef9-aaa6-afcc496c9bed'

/** An entry `warmThrice()` repeats, under its new uuid. */
function again(uuid: string) {
  return `cccccccc${uuid.slice(8)}`
}

const THIRD_MESSAGE = again(SECOND_MESSAGE)

type Streamed = StartReplyEvent

const cleanUps: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanUp of cleanUps.splice(0).toReversed()) await cleanUp()
})

function folder(prefix: string) {
  const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  cleanUps.push(async () => fs.rmSync(made, {recursive: true, force: true}))

  return made
}

function read(name: string): RecordedLine[] {
  return fs
    .readFileSync(path.join(RECORDINGS, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => RecordedLineSchema.parse(JSON.parse(line)))
}

function edited(name: string, edit: (lines: RecordedLine[]) => RecordedLine[]) {
  const file = path.join(folder('uz-recording-'), name)
  fs.writeFileSync(
    file,
    edit(read(name))
      .map(line => `${JSON.stringify(line)}\n`)
      .join('')
  )

  return file
}

async function setUp(
  recordings: string[],
  behavior: FakeClaudeOptions = {},
  store = fakeStore()
) {
  const fake = await replayClaude()
  cleanUps.push(fake.cleanUp)
  const configDir = folder('uz-claude-config-')
  const reports = folder('uz-claude-reports-')
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []

  const driver = createClaudeDriver({
    store: store.client,
    spawn: options => {
      const child = spawnClaude(options)
      exits.push(once(child, 'exit').catch(() => undefined))

      return child
    },
    env: {
      PATH: process.env.PATH ?? '',
      ...fakeClaudeEnv(
        recordings.map(name =>
          path.isAbsolute(name) ? name : path.join(RECORDINGS, name)
        ),
        reports,
        behavior
      ),
    },
    whenIdle: idle.whenIdle,
  })

  const treeId = crypto.randomUUID()

  interface ReplyOptions {
    /** 0 stops the Reply as it starts. */
    stopAfterDeltas?: number
    replyId?: string
    model?: string
    messageId?: ReplyRequest['prompt']['messageId']
    compactionSettings?: CompactionSettings
    thread?: Thread
  }

  const vendorProgram = {
    program: {
      path: fake.program,
      build: {url: 'https://example.com/claude', sha256: '', size: 0},
    },
    configDir,
  }

  async function reply(
    text: string,
    session: SessionRef | ReplySession | null = null,
    {
      stopAfterDeltas,
      replyId = crypto.randomUUID(),
      model = 'haiku',
      messageId = crypto.randomUUID(),
      compactionSettings = DEFAULT_COMPACTION_SETTINGS,
      thread = [],
    }: ReplyOptions = {}
  ) {
    const events: Streamed[] = []
    let deltas = 0

    for await (const event of driver.startReply({
      treeId,
      replyId,
      model,
      systemPrompt: '',
      prompt: {text, messageId},
      vendorProgram,
      session: session && {type: 'continue', ...session},
      thread,
      compactionSettings,
    })) {
      events.push(event)

      if (
        (event.type === 'RUN_STARTED' && stopAfterDeltas === 0) ||
        (event.type === 'TEXT_DELTA' && ++deltas === stopAfterDeltas)
      ) {
        await driver.stop(replyId)
      }
    }

    return events
  }

  function reportsSoFar() {
    return fs
      .readdirSync(reports)
      .toSorted((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map(file =>
        FakeClaudeRunSchema.parse(
          JSON.parse(fs.readFileSync(path.join(reports, file), 'utf8'))
        )
      )
  }

  async function allClosed() {
    idle.pass()
    await expect
      .poll(() => reportsSoFar().every(report => report.ended !== null))
      .toBe(true)
  }

  // Windows can't remove a folder while a `claude` still runs in it.
  cleanUps.push(async () => {
    idle.pass()
    await Promise.all(exits)
  })

  return {
    driver,
    vendorProgram,
    configDir,
    projectKey: projectKeyOf(configDir),
    store,
    reply,
    reports: reportsSoFar,
    allClosed,
  }
}

function recordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
  )

  if (!recorded) throw new Error('The Reply was not recorded')

  return recorded.session
}

function replyEvents(events: Streamed[]) {
  return events.filter(isReplyEvent)
}

function shown(events: Streamed[]) {
  return replyEvents(events).reduce(foldReplyEvent, NEW_REPLY)
}

function textOf(events: Streamed[]) {
  return shown(events)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

const FIRST_PROMPT = 'Reply with the single word TEAL.'
const SECOND_PROMPT = 'Now reply with the single word OTTER.'
const THIRD_PROMPT = 'Which two words did you reply with? Just the words.'
const FORK_PROMPT = 'Which word did you reply with? Just the word.'
const COUNT_PROMPT = 'Count from 1 to 300, one number per line.'
const ASK_PROMPT = 'What did I ask you to do? Answer in five words.'

it('streams a Reply, records where Claude saved it, and reports its Context size', async () => {
  const claude = await setUp(['warm.ndjson'])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events[0]?.type).toBe('RUN_STARTED')
  expect(textOf(events)).toBe('TEAL')
  // Provider-reported: what this request sent and wrote, not a running sum.
  expect(shown(events).contextSize).toBe(2 + 0 + 584 + 6)
  expect(events.slice(-2)).toEqual([
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      model: MODEL,
      session: {sessionId: SESSION_ID, messageId: FIRST_MESSAGE},
    }),
    expect.objectContaining({
      type: 'RUN_FINISHED',
      status: 'complete',
      contextWindow: 1_000_000,
    }),
  ])
  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(FIRST_MESSAGE)

  await claude.reply(SECOND_PROMPT, recordedIn(events))
  await claude.allClosed()
})

async function warmThread(claude: Awaited<ReturnType<typeof setUp>>) {
  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))
  await claude.allClosed()

  // Gone from `claude`'s own folder, so only the app's copy can bring it back.
  fs.rmSync(path.join(claude.configDir, 'projects'), {
    recursive: true,
    force: true,
  })

  return recordedIn(second)
}

it('resumes a cold session from the app’s copy alone', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'])
  const session = await warmThread(claude)

  const third = await claude.reply(THIRD_PROMPT, session)

  expect(textOf(third)).toBe('TEAL OTTER')
  expect(recordedIn(third)).toEqual({
    sessionId: SESSION_ID,
    messageId: RESUMED_MESSAGE,
  })

  await claude.allClosed()
  const [, resumed] = claude.reports()

  expect(resumed?.args).toContain(`--resume=${SESSION_ID}`)
  expect(resumed?.resumedFrom).toEqual(
    expect.arrayContaining([FIRST_MESSAGE, SECOND_MESSAGE])
  )
  // The SDK's own folder, which it fills from the store.
  expect(resumed?.configDir).not.toBe(claude.configDir)
})

it('forks the session through a mid-Thread Reply into a new session, leaving the warm one alone', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson', 'forked.ndjson'])
  const session = await warmThread(claude)
  await claude.reply(THIRD_PROMPT, session)

  const first = {sessionId: SESSION_ID, messageId: FIRST_MESSAGE}
  const forked = await claude.reply(FORK_PROMPT, {...first, type: 'fork'})

  expect(textOf(forked)).toBe('TEAL')
  expect(recordedIn(forked)).toEqual({
    sessionId: FORKED_SESSION_ID,
    messageId: FORKED_MESSAGE,
  })
  expect(
    claude.store
      .entriesOf(claude.projectKey, FORKED_SESSION_ID)
      .map(entry => entry.uuid)
  ).toEqual(expect.arrayContaining([FIRST_MESSAGE, FORKED_MESSAGE]))

  const [, resumed, fork] = claude.reports()

  expect(resumed?.ended).toBeNull()
  expect(fork?.args).toEqual(
    expect.arrayContaining([
      `--resume=${SESSION_ID}`,
      `--resume-session-at=${FIRST_MESSAGE}`,
      '--fork-session',
    ])
  )
  // Restored whole for `claude` to fork; the fork is its to cut.
  expect(fork?.resumedFrom).toEqual(
    expect.arrayContaining([FIRST_MESSAGE, SECOND_MESSAGE])
  )
  expect(fork?.prompts).toEqual([FORK_PROMPT])

  await claude.allClosed()
  expect(claude.reports().map(report => report.ended)).toEqual([
    'input-closed',
    'input-closed',
    'input-closed',
  ])
})

const REACHING = {
  sessionId: SESSION_ID,
  messageId: FIRST_MESSAGE,
  type: 'fork',
  servedThrough: FIRST_MESSAGE,
} as const

it('forks from the app’s copy of the session served only through a Reply', async () => {
  const claude = await setUp(['warm.ndjson', 'forked.ndjson'])
  await warmThread(claude)

  const forked = await claude.reply(FORK_PROMPT, REACHING)
  const [, fork] = claude.reports()

  expect(textOf(forked)).toBe('TEAL')
  expect(fork?.configDir).not.toBe(claude.configDir)
  expect(fork?.resumedFrom.at(-1)).toBe(FIRST_MESSAGE)
  expect(fork?.resumedFrom).not.toContain(SECOND_MESSAGE)

  await claude.allClosed()
})

it('writes the transcript back only through that Reply when forking from the store fails', async () => {
  const claude = await setUp(
    ['warm.ndjson', 'forked.ndjson', 'forked.ndjson'],
    {refuseStore: true}
  )

  await warmThread(claude)

  const forked = await claude.reply(FORK_PROMPT, REACHING)
  const [, refused, fallback] = claude.reports()

  expect(textOf(forked)).toBe('TEAL')
  expect(refused?.ended).toBe('refused')
  expect(fallback?.configDir).toBe(claude.configDir)
  expect(fallback?.resumedFrom.at(-1)).toBe(FIRST_MESSAGE)
  expect(fallback?.resumedFrom).not.toContain(SECOND_MESSAGE)

  await claude.allClosed()
})

it('resumes from the app’s copy when the warm session’s `claude` exited while idle', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'], {
    exitAfter: 2,
  })

  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  await expect.poll(() => claude.reports()[0]?.ended).toBe('exited')

  const third = await claude.reply(THIRD_PROMPT, recordedIn(second))

  expect(textOf(third)).toBe('TEAL OTTER')
  expect(third.at(-1)).toMatchObject({status: 'complete'})

  await claude.allClosed()
  const [, resumed] = claude.reports()

  expect(resumed?.args).toContain(`--resume=${SESSION_ID}`)
  expect(resumed?.prompts).toEqual([THIRD_PROMPT])
})

it('writes the transcript back when resuming from the store fails', async () => {
  const claude = await setUp(
    ['warm.ndjson', 'resumed.ndjson', 'resumed.ndjson'],
    {refuseStore: true}
  )

  const session = await warmThread(claude)
  const messageId = crypto.randomUUID()

  const third = await claude.reply(THIRD_PROMPT, session, {messageId})

  expect(textOf(third)).toBe('TEAL OTTER')
  expect(third.at(-1)).toMatchObject({status: 'complete'})
  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(messageId)

  await claude.allClosed()
  const [, refused, fallback] = claude.reports()

  expect(refused?.ended).toBe('refused')
  expect(fallback?.configDir).toBe(claude.configDir)
  expect(fallback?.resumedFrom).toEqual(
    expect.arrayContaining([FIRST_MESSAGE, SECOND_MESSAGE])
  )
})

it('keeps the files beside a session and puts them back when it resumes', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'], {
    toolResult: 'toolu_1.txt',
  })

  const session = await warmThread(claude)

  expect([
    ...claude.store.filesOf(claude.projectKey, SESSION_ID).keys(),
  ]).toEqual(['tool-results/toolu_1.txt'])

  await claude.reply(THIRD_PROMPT, session)
  await claude.allClosed()

  expect(claude.reports()[1]?.toolResults).toEqual(['toolu_1.txt'])
})

it('fails the Reply when the app can’t save its files, and closes its `claude`', async () => {
  const claude = await setUp(
    ['warm.ndjson'],
    {toolResult: 'toolu_1.txt'},
    fakeStore({'save-files': 'database or disk is full'})
  )

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.map(event => event.type)).not.toContain('REPLY_RECORDED')
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'disk-full'},
  })
  await expect.poll(() => claude.reports()[0]?.inputClosed).toBe(true)
})

it('replaces the text when a broken stream is sent again', async () => {
  const resent = edited('warm.ndjson', lines => {
    const start = lines.findIndex(
      line =>
        line.kind === 'out' &&
        line.message.type === 'stream_event' &&
        JSON.stringify(line.message).includes('"message_start"')
    )

    const broken = lines
      .slice(start, start + 3)
      .map(line =>
        line.kind === 'out'
          ? JSON.parse(JSON.stringify(line).replace('"TEAL"', '"TE"'))
          : line
      )

    return [...lines.slice(0, start), ...broken, ...lines.slice(start)]
  })

  const claude = await setUp([resent])

  const events = await claude.reply(FIRST_PROMPT)

  expect(
    replyEvents(events).flatMap(event =>
      event.type === 'TEXT_DELTA' || event.type === 'TEXT_REPLACE'
        ? [event]
        : []
    )
  ).toEqual([
    expect.objectContaining({type: 'TEXT_DELTA', delta: 'TE'}),
    expect.objectContaining({type: 'TEXT_REPLACE', text: ''}),
    expect.objectContaining({type: 'TEXT_DELTA', delta: 'TEAL'}),
  ])
  expect(textOf(events)).toBe('TEAL')

  await claude.reply(SECOND_PROMPT, recordedIn(events))
  await claude.allClosed()
})

function streamed(event: SDKPartialAssistantMessage['event']): RecordedLine {
  return {
    kind: 'out',
    message: {
      type: 'stream_event',
      event,
      session_id: SESSION_ID,
      parent_tool_use_id: null,
      uuid: crypto.randomUUID(),
    },
  }
}

it('shows thinking as it streams, and never as part of the Reply', async () => {
  const thinking = edited('warm.ndjson', lines => {
    const start = lines.findIndex(
      line =>
        line.kind === 'out' &&
        JSON.stringify(line.message).includes('"content_block_start"')
    )

    return [
      ...lines.slice(0, start),
      streamed({
        type: 'content_block_start',
        index: 0,
        content_block: {type: 'thinking', thinking: '', signature: ''},
      }),
      streamed({
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'thinking_delta',
          thinking: 'One word, then.',
          estimated_tokens: null,
        },
      }),
      streamed({type: 'content_block_stop', index: 0}),
      ...lines.slice(start),
    ]
  })

  const claude = await setUp([thinking])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events).toContainEqual(
    expect.objectContaining({
      type: 'REASONING_DELTA',
      delta: 'One word, then.',
    })
  )
  expect(textOf(events)).toBe('TEAL')

  await claude.reply(SECOND_PROMPT, recordedIn(events))
  await claude.allClosed()
})

function compactionsIn(events: Streamed[]) {
  return events.filter(event => event.type === 'CONTEXT_COMPACTED')
}

async function compactingThread(recording: string) {
  const claude = await setUp([recording])
  const first = await claude.reply('My code word is TEAL.')

  const failedCompacting = await claude.reply(
    'My ship is PELICAN.',
    recordedIn(first)
  )

  const replyId = crypto.randomUUID()

  const compacting = await claude.reply(
    'Reply with the single word OTTER.',
    recordedIn(failedCompacting),
    {replyId}
  )

  await claude.allClosed()

  return {first, failedCompacting, compacting, replyId}
}

it('reports a compaction Claude made inside a Reply, with the session and its boundary entry, and none for one that failed', async () => {
  const {first, failedCompacting, compacting, replyId} =
    await compactingThread('compacted.ndjson')

  expect(compactionsIn(compacting)).toEqual([
    expect.objectContaining({
      replyId,
      sessionId: COMPACTED_SESSION_ID,
      boundaryId: BOUNDARY_ENTRY,
    }),
  ])
  expect(textOf(compacting)).toBe('OTTER')
  expect(compactionsIn([...first, ...failedCompacting])).toEqual([])
})

it('reports no compaction when a hook blocked it, which ends the compacting with no boundary entry', async () => {
  const blocked = edited('compacted.ndjson', lines =>
    lines.flatMap(line => {
      if (line.kind !== 'out' || line.message.type !== 'system') return [line]

      if (line.message.subtype === 'compact_boundary') return []

      const {compact_result: _, ...status} = line.message

      return [{...line, message: status}]
    })
  )

  const {compacting} = await compactingThread(blocked)

  expect(compactionsIn(compacting)).toEqual([])
  expect(textOf(compacting)).toBe('OTTER')
})

it('fails the Reply with Claude’s reason, without recording it', async () => {
  const failing = edited('warm.ndjson', lines =>
    lines.map(line =>
      line.kind === 'out' && line.message.type === 'result'
        ? {
            ...line,
            message: {
              ...line.message,
              is_error: true,
              result: 'Prompt is too long',
            },
          }
        : line
    )
  )

  const claude = await setUp([failing])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.map(event => event.type)).not.toContain('REPLY_RECORDED')
  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'provider-error', message: 'Prompt is too long'},
    })
  )
  await claude.allClosed()
})

function endedAs(
  terminalReason: string,
  rateLimit?: {status: string; resetsAt?: number}
) {
  return edited('warm.ndjson', lines =>
    lines.map(line => {
      if (line.kind !== 'out') return line

      if (rateLimit && line.message.type === 'rate_limit_event') {
        return {...line, message: {...line.message, rate_limit_info: rateLimit}}
      }

      return line.message.type === 'result'
        ? {
            ...line,
            message: {
              ...line.message,
              is_error: true,
              result: 'Prompt is too long',
              terminal_reason: terminalReason,
            },
          }
        : line
    })
  )
}

it('fails the Reply as too long when Claude’s result ends as prompt_too_long', async () => {
  const claude = await setUp([endedAs('prompt_too_long')])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.map(event => event.type)).not.toContain('REPLY_RECORDED')
  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'too-long', message: 'Prompt is too long'},
  })
  await claude.allClosed()
})

it('keeps a limit Claude rejected the turn for a reached limit, with no reset time', async () => {
  const claude = await setUp([endedAs('blocking_limit', {status: 'rejected'})])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'limit-reached', message: 'Prompt is too long'},
  })
  await claude.allClosed()
})

it('names a limit Claude ran into, with when it lifts', async () => {
  const limited = edited('warm.ndjson', lines =>
    lines.map(line =>
      line.kind === 'out' && line.message.type === 'result'
        ? {
            ...line,
            message: {
              ...line.message,
              is_error: true,
              result: 'You’ve hit your limit · resets 2026-10-24T15:00:00Z',
            },
          }
        : line
    )
  )

  const claude = await setUp([limited])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'limit-reached', resetsAt: '2026-10-24T15:00:00.000Z'},
  })
  await claude.allClosed()
})

it('names when a limit lifts as Claude reported it apart from the message', async () => {
  const limited = edited('warm.ndjson', lines =>
    lines.map(line => {
      if (line.kind !== 'out') return line

      if (line.message.type === 'rate_limit_event') {
        return {
          ...line,
          message: {
            ...line.message,
            rate_limit_info: {status: 'rejected', resetsAt: 1793970000},
          },
        }
      }

      return line.message.type === 'result'
        ? {
            ...line,
            message: {
              ...line.message,
              is_error: true,
              result: 'You’ve hit your limit · resets 3pm (Europe/London)',
            },
          }
        : line
    })
  )

  const claude = await setUp([limited])

  const events = await claude.reply(FIRST_PROMPT)

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'limit-reached', resetsAt: '2026-11-06T13:00:00.000Z'},
  })
  await claude.allClosed()
})

it('fails the Reply as a crash when `claude` exits before its result, keeping the text so far', async () => {
  const crashing = edited('warm.ndjson', lines => {
    const result = lines.findIndex(
      line => line.kind === 'out' && line.message.type === 'result'
    )

    return lines.toSpliced(result, 1)
  })

  const claude = await setUp([crashing], {exitAfter: 1})

  const messageId = crypto.randomUUID()

  const events = await claude.reply(FIRST_PROMPT, null, {messageId})

  expect(textOf(events)).toBe('TEAL')
  expect(events.map(event => event.type)).not.toContain('REPLY_RECORDED')
  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(messageId)
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'program-crashed'},
  })
  await claude.allClosed()
  expect(claude.reports()[0]?.ended).toBe('exited')
})

it('saves the Prompt while the Reply streams, so a quit mid-Reply keeps it', async () => {
  const claude = await setUp(['stopped.ndjson'])
  const replyId = crypto.randomUUID()
  const replying = claude.reply(COUNT_PROMPT, null, {replyId})

  try {
    await expect
      .poll(() =>
        claude.store
          .entriesOf(claude.projectKey, STOPPED_SESSION_ID)
          .map(entry => entry.type)
      )
      .toContain('user')
  } finally {
    await claude.driver.stop(replyId)
    await replying
  }
})

it('stores the Prompt in the app’s copy of the session under the id main gave it', async () => {
  const claude = await setUp(['warm.ndjson'])
  const messageId = crypto.randomUUID()

  await claude.reply(FIRST_PROMPT, null, {messageId})

  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .flatMap(entry => (entry.type === 'user' ? [entry.uuid] : []))
  ).toEqual([messageId])
})

it('sends a Prompt that starts with a claude command marked to be delivered as written', async () => {
  const claude = await setUp(['warm.ndjson'])

  await claude.reply('/compact')

  expect(claude.reports()[0]).toMatchObject({
    prompts: ['/compact'],
    clientComposed: [true],
  })
})

it('passes on a stop asked before claude has the Prompt', async () => {
  const claude = await setUp(['stopped.ndjson'])

  const stopped = await claude.reply(COUNT_PROMPT, null, {stopAfterDeltas: 0})

  expect(stopped.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'stopped',
  })
})

it('stops a Reply where it is, records it, and continues the Thread warm from it', async () => {
  const claude = await setUp(['stopped.ndjson'])

  const stopped = await claude.reply(COUNT_PROMPT, null, {stopAfterDeltas: 5})

  expect(textOf(stopped)).toBe(
    Array.from({length: 30}, (_, index) => index + 1).join('\n')
  )
  expect(stopped.slice(-2)).toEqual([
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      model: MODEL,
      session: {sessionId: STOPPED_SESSION_ID, messageId: STOPPED_MESSAGE},
    }),
    {
      treeId: expect.any(String),
      replyId: expect.any(String),
      type: 'RUN_FINISHED',
      status: 'stopped',
      contextWindow: 1_000_000,
    },
  ])
  expect(
    claude.store
      .entriesOf(claude.projectKey, STOPPED_SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(STOPPED_MESSAGE)

  const asked = await claude.reply(ASK_PROMPT, recordedIn(stopped))

  expect(textOf(asked)).toBe('Count from 1 to 300.')
  expect(recordedIn(asked)).toEqual({
    sessionId: STOPPED_SESSION_ID,
    messageId: ASKED_MESSAGE,
  })
  expect(shown(asked).contextSize).toBe(2 + 157 + 586 + 12)

  await claude.allClosed()
  const [report] = claude.reports()

  expect(claude.reports()).toHaveLength(1)
  expect(report?.prompts).toEqual([COUNT_PROMPT, ASK_PROMPT])
  expect(report?.ended).toBe('input-closed')
})

it('rewinds a cold session to an earlier Reply and goes on from there, in the same session', async () => {
  const claude = await setUp(['rewound-warm.ndjson', 'rewound.ndjson'])

  const first = await claude.reply(FIRST_PROMPT)
  await claude.reply(SECOND_PROMPT, recordedIn(first))
  await claude.allClosed()
  fs.rmSync(path.join(claude.configDir, 'projects'), {
    recursive: true,
    force: true,
  })

  const rewound = await claude.reply(FORK_PROMPT, {
    ...recordedIn(first),
    type: 'rewind',
  })

  expect(textOf(rewound)).toBe('TEAL')
  expect(recordedIn(rewound)).toEqual({
    sessionId: REWOUND_SESSION_ID,
    messageId: REWOUND_MESSAGE,
  })

  await claude.allClosed()
  const [, rewind] = claude.reports()

  expect(rewind?.args).toEqual(
    expect.arrayContaining([
      `--resume=${REWOUND_SESSION_ID}`,
      `--resume-session-at=${TEAL_MESSAGE}`,
    ])
  )
  expect(rewind?.args).not.toContain('--fork-session')
  // Restored whole from the app's copy; the cut is `claude`'s to make.
  expect(rewind?.resumedFrom).toEqual(
    expect.arrayContaining([TEAL_MESSAGE, OTTER_MESSAGE])
  )
  expect(rewind?.prompts).toEqual([FORK_PROMPT])
})

it('never rewinds in the warm session standing there: it closes, and a new `claude` resumes the cut session', async () => {
  const claude = await setUp(['rewound-warm.ndjson', 'rewound.ndjson'])

  const first = await claude.reply(FIRST_PROMPT)

  const rewound = await claude.reply(FORK_PROMPT, {
    ...recordedIn(first),
    type: 'rewind',
  })

  expect(textOf(rewound)).toBe('TEAL')
  expect(recordedIn(rewound).sessionId).toBe(REWOUND_SESSION_ID)
  await expect.poll(() => claude.reports()[0]?.ended).not.toBeNull()

  await claude.allClosed()
  const [warm, rewind] = claude.reports()

  expect(warm?.prompts).toEqual([FIRST_PROMPT])
  expect(rewind?.args).toContain(`--resume-session-at=${TEAL_MESSAGE}`)
  expect(rewind?.prompts).toEqual([FORK_PROMPT])
})

it('cuts a Retry’s session after the Prompt of the Reply cut short, which `claude` resumes at', async () => {
  const claude = await setUp(['rewound-warm.ndjson', 'rewound.ndjson'])

  const first = await claude.reply(FIRST_PROMPT)
  const keepThrough = crypto.randomUUID()
  await claude.reply(SECOND_PROMPT, recordedIn(first), {messageId: keepThrough})
  await claude.allClosed()

  await claude.reply(FORK_PROMPT, {
    ...recordedIn(first),
    type: 'cut',
    keepThrough,
    dropFrom: null,
  })

  await claude.allClosed()
  const [, retry] = claude.reports()

  expect(retry?.args).toEqual(
    expect.arrayContaining([
      `--resume=${REWOUND_SESSION_ID}`,
      `--resume-session-at=${keepThrough}`,
    ])
  )
  expect(retry?.args).not.toContain('--fork-session')
  expect(retry?.prompts).toEqual([FORK_PROMPT])
})

const UUID = /[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/g

/** `warm.ndjson` with its second Prompt sent again, under new uuids. */
function warmThrice() {
  return edited('warm.ndjson', lines => {
    const second = lines.findLastIndex(
      line => line.kind === 'in' && line.message.type === 'user'
    )

    const end = lines.findIndex(line => line.kind === 'end')

    const repeated = lines
      .slice(second, end)
      .map(line =>
        RecordedLineSchema.parse(
          JSON.parse(
            JSON.stringify(line).replaceAll(UUID, uuid =>
              uuid === SESSION_ID ? uuid : again(uuid)
            )
          )
        )
      )

    return lines.toSpliced(end, 0, ...repeated)
  })
}

async function threeReplies(claude: Awaited<ReturnType<typeof setUp>>) {
  const first = await claude.reply(FIRST_PROMPT)
  const messageId = crypto.randomUUID()

  const second = await claude.reply(SECOND_PROMPT, recordedIn(first), {
    messageId,
  })

  await claude.reply(THIRD_PROMPT, recordedIn(second))

  return {
    first: recordedIn(first),
    deleted: {sessionId: recordedIn(second).sessionId, messageId},
  }
}

it('leaves deleted Turns for the next Prompt, which resumes at the Reply it answers, so the AI’s context lacks them', async () => {
  const claude = await setUp([warmThrice(), 'resumed.ndjson'])
  const {first, deleted} = await threeReplies(claude)

  const cut = {
    ...first,
    type: 'cut' as const,
    keepThrough: first.messageId,
    dropFrom: deleted.messageId,
  }

  await expect(
    claude.driver.cutSession({
      session: cut,
      vendorProgram: {program: null, configDir: claude.configDir},
    })
  ).resolves.toBe(false)

  const next = await claude.reply(FORK_PROMPT, cut)

  expect(next.at(-1)).toMatchObject({status: 'complete'})
  await claude.allClosed()
  const [, resumed] = claude.reports()

  expect(resumed?.args).toContain(`--resume-session-at=${FIRST_MESSAGE}`)
  expect(resumed?.resumedFrom).toEqual(
    expect.arrayContaining([deleted.messageId, SECOND_MESSAGE, THIRD_MESSAGE])
  )
})

it('waits for the warm `claude` it closes to end before resuming that session at an earlier Reply', async () => {
  const hold = path.join(folder('uz-claude-hold-'), 'go')

  const claude = await setUp([warmThrice(), 'resumed.ndjson'], {
    holdExit: hold,
  })

  cleanUps.push(async () => fs.writeFileSync(hold, ''))

  const {first, deleted} = await threeReplies(claude)
  const askedBefore = claude.store.asked.length

  const next = claude.reply(FORK_PROMPT, {
    ...first,
    type: 'cut',
    keepThrough: first.messageId,
    dropFrom: deleted.messageId,
  })

  await expect.poll(() => claude.reports()[0]?.inputClosed).toBe(true)
  // The warm one is held open, so any ask by now came from the driver.
  expect(
    claude.store.asked.slice(askedBefore).filter(op => op !== 'append')
  ).toEqual([])
  fs.writeFileSync(hold, '')

  expect((await next).at(-1)).toMatchObject({status: 'complete'})
  await claude.allClosed()
  const [warm, resumed] = claude.reports()

  expect(warm?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT, THIRD_PROMPT])
  expect(resumed?.args).toContain(`--resume-session-at=${FIRST_MESSAGE}`)
  expect(resumed?.runningAtStart).toEqual([])
})

it('resumes the session in a new `claude` on the Model a Prompt asks for, closing the warm one on the old Model first', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'])

  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  const third = await claude.reply(THIRD_PROMPT, recordedIn(second), {
    model: 'sonnet',
  })

  expect(textOf(third)).toBe('TEAL OTTER')
  const [warm, resumed] = claude.reports()

  expect(warm?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT])
  expect(warm?.ended).toBe('input-closed')
  expect(resumed?.args).toEqual(
    expect.arrayContaining([`--resume=${SESSION_ID}`, '--model=sonnet'])
  )
  expect(resumed?.runningAtStart).toEqual([])
})

it('starts the next Prompt’s `claude` on the Model it asks for after a Reply failed on a Model that doesn’t exist', async () => {
  const failedFirst = edited('warm.ndjson', lines => {
    const failing = lines.map(line =>
      line.kind === 'out' && line.message.type === 'result'
        ? {
            ...line,
            message: {
              ...line.message,
              is_error: true,
              result:
                'There’s an issue with the selected model (claude-nonexistent-201). It may not exist or you may not have access to it.',
            },
          }
        : line
    )

    const second = failing.findIndex(
      (line, at) => at > 2 && line.kind === 'in' && line.message.type === 'user'
    )

    const end = failing.findIndex(line => line.kind === 'end')

    // Only the failed Prompt: a second one in this `claude` is unexpected.
    return failing.toSpliced(second, end - second)
  })

  const claude = await setUp([failedFirst, 'resumed.ndjson'])

  const messageId = crypto.randomUUID()

  const failed = await claude.reply(FIRST_PROMPT, null, {
    model: 'claude-nonexistent-201',
    messageId,
  })

  const next = await claude.reply(
    SECOND_PROMPT,
    {sessionId: SESSION_ID, messageId},
    {model: MODEL}
  )

  expect(failed.at(-1)).toMatchObject({status: 'failed'})
  expect(next.at(-1)).toMatchObject({status: 'complete'})
  const [bad, resumed] = claude.reports()

  expect(bad?.args).toContain('--model=claude-nonexistent-201')
  expect(bad?.ended).toBe('input-closed')
  expect(resumed?.args).toEqual(
    expect.arrayContaining([`--resume=${SESSION_ID}`, `--model=${MODEL}`])
  )
})

it('continues in the warm `claude` on another name for its Model', async () => {
  const claude = await setUp(['warm.ndjson'])
  const changes: Model[][] = []
  claude.driver.onModelsChanged(models => changes.push(models))

  const first = await claude.reply(FIRST_PROMPT, null, {
    model: 'claude-opus-5-5',
  })

  await expect.poll(() => changes.length).toBe(1)
  await claude.reply(SECOND_PROMPT, recordedIn(first), {model: 'opus'})

  await claude.allClosed()
  const [warm] = claude.reports()

  expect(claude.reports()).toHaveLength(1)
  expect(warm?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT])
})

/** `warm.ndjson`'s `claude` as it starts, asked for no Prompt. */
function listedOnly() {
  return edited('warm.ndjson', lines =>
    lines.filter(
      line =>
        line.kind === 'start' ||
        line.kind === 'end' ||
        line.message.type === 'control_request' ||
        line.message.type === 'control_response'
    )
  )
}

it('lists the Models from a `claude` it starts before any Prompt, then those of the newest one, telling each change', async () => {
  const claude = await setUp([listedOnly(), 'warm.ndjson', 'resumed.ndjson'])
  const changes: Model[][] = []
  claude.driver.onModelsChanged(models => changes.push(models))

  const listed = await claude.driver.listModels(claude.vendorProgram)

  expect(changes).toEqual([listed])
  const [reader] = claude.reports()

  expect(reader?.configDir).toBe(claude.configDir)
  expect(reader?.ended).toBe('input-closed')

  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  expect(changes[0]?.slice(0, 2)).toEqual([
    {
      id: 'default',
      name: 'Default (recommended)',
      isDefault: true,
      resolvesTo: 'claude-opus-5-5',
      needsAppUpdate: false,
    },
    {
      id: 'opus',
      name: 'Opus 5.5',
      isDefault: false,
      resolvesTo: 'claude-opus-5-5',
      needsAppUpdate: false,
    },
  ])
  expect(changes[0]).toHaveLength(13)

  await claude.reply(THIRD_PROMPT, recordedIn(second), {model: 'sonnet'})
  await expect.poll(() => changes.length).toBe(2)

  expect(changes[1]?.[0]).toMatchObject({resolvesTo: 'claude-fable-5-1'})
  await expect(claude.driver.listModels(claude.vendorProgram)).resolves.toEqual(
    changes[1]
  )
  expect(claude.reports()).toHaveLength(3)
})

it('fails to list the Models when the manifest names no Claude program', async () => {
  const claude = await setUp([])

  await expect(
    claude.driver.listModels({program: null, configDir: claude.configDir})
  ).rejects.toThrow('The manifest names no Claude program.')
})

it('learns nothing from a `claude` whose Models can’t be read, and writes the Reply all the same', async () => {
  const claude = await setUp([
    edited('warm.ndjson', lines =>
      lines.map(line =>
        RecordedLineSchema.parse(
          JSON.parse(JSON.stringify(line).replaceAll('"models":', '"gone":'))
        )
      )
    ),
    'resumed.ndjson',
  ])

  const changes: Model[][] = []
  claude.driver.onModelsChanged(models => changes.push(models))

  const first = await claude.reply(FIRST_PROMPT)

  expect(textOf(first)).toBe('TEAL')
  expect(first.at(-1)).toMatchObject({status: 'complete'})

  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))
  await claude.reply(THIRD_PROMPT, recordedIn(second), {model: 'sonnet'})
  await expect.poll(() => changes.length).toBe(1)

  expect(changes[0]?.[0]).toMatchObject({resolvesTo: 'claude-fable-5-1'})
})

it('starts claude with the Compaction Settings, and with nothing for the defaults', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'])
  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  const third = await claude.reply(THIRD_PROMPT, recordedIn(second), {
    compactionSettings: {auto: false, threshold: 150_000},
  })

  expect(textOf(third)).toBe('TEAL OTTER')

  await claude.allClosed()
  const [warm, changed] = claude.reports()

  expect(warm?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT])
  expect(warm?.args.join(' ')).not.toMatch(/autoCompact/)
  expect(changed?.args).toContain(`--resume=${SESSION_ID}`)
  expect(changed?.args.join(' ')).toMatch(/"autoCompactEnabled":false/)
  expect(changed?.args.join(' ')).toMatch(/"autoCompactWindow":150000/)
})

/** A Thread ChatGPT wrote, as main hands it over. */
const HANDED_OVER: Thread = [
  {
    prompt: 'Name a color.',
    reply: [{type: 'text', text: 'Teal.'}],
    label: '[Reply written by GPT-6 Sol]',
  },
  {
    prompt: 'And an animal?',
    reply: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'search',
        args: '{"query":"animals"}',
        result: {content: 'Otters are animals.', isError: false},
      },
      {type: 'text', text: 'Otter.'},
    ],
    label: '[Reply written by GPT-6 Sol]',
  },
]

const HANDED_OVER_TURNS = [
  '<thread>',
  '<prompt>\nName a color.\n</prompt>',
  '<reply>\n[Reply written by GPT-6 Sol]\n\nTeal.\n</reply>',
  '<prompt>\nAnd an animal?\n</prompt>',
  '<reply>\n[Reply written by GPT-6 Sol]\n\n[Tool call: search]\n{"query":"animals"}\n[Tool result]\nOtters are animals.\n\nOtter.\n</reply>',
  '</thread>',
].join('\n')

it('takes over a Thread ChatGPT wrote: a new session, told the whole Thread and the Prompt in one user message', async () => {
  const claude = await setUp(['warm.ndjson'])
  const messageId = crypto.randomUUID()

  const events = await claude.reply(FIRST_PROMPT, null, {
    thread: HANDED_OVER,
    messageId,
  })

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(recordedIn(events)).toEqual({
    sessionId: SESSION_ID,
    messageId: FIRST_MESSAGE,
  })

  const [started] = claude.reports()

  expect(started?.args.join(' ')).not.toMatch(/--resume/)
  expect(started?.systemPrompt.join('')).toBe(explainingLabels('', HANDED_OVER))
  expect(events.filter(event => event.type === 'SESSION_REBUILT')).toHaveLength(
    1
  )
  expect(started?.prompts).toHaveLength(1)
  expect(started?.prompts[0]).toContain(HANDED_OVER_TURNS)
  expect(started?.prompts[0]?.endsWith(`</thread>\n\n${FIRST_PROMPT}`)).toBe(
    true
  )
  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(messageId)

  await claude.allClosed()
})

it('keeps the line that explains the labels when a rebuilt session resumes in a new claude', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'])
  const first = await claude.reply(FIRST_PROMPT, null, {thread: HANDED_OVER})
  await claude.allClosed()

  const thread: Thread = [
    ...HANDED_OVER,
    {prompt: FIRST_PROMPT, reply: [{type: 'text', text: 'TEAL'}], label: null},
  ]

  const events = await claude.reply(THIRD_PROMPT, recordedIn(first), {thread})

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  await claude.allClosed()
  const [, resumed] = claude.reports()

  expect(resumed?.args).toContain(`--resume=${SESSION_ID}`)
  expect(resumed?.systemPrompt.join('')).toBe(explainingLabels('', thread))
})

it('sends a Tree’s first Prompt as written, with no Thread to tell', async () => {
  const claude = await setUp(['warm.ndjson'])

  await claude.reply(FIRST_PROMPT)

  expect(claude.reports()[0]?.prompts).toEqual([FIRST_PROMPT])

  await claude.allClosed()
})

it('says nothing of a rebuild for a session it restores', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'])
  const session = await warmThread(claude)

  const events = await claude.reply(THIRD_PROMPT, session, {
    thread: HANDED_OVER,
  })

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(events.some(event => event.type === 'SESSION_REBUILT')).toBe(false)

  await claude.allClosed()
})

it('rebuilds a session the app has no copy of from the Thread, in a new session', async () => {
  const claude = await setUp(['resumed.ndjson', 'warm.ndjson'])

  const events = await claude.reply(
    FIRST_PROMPT,
    {sessionId: crypto.randomUUID(), messageId: crypto.randomUUID()},
    {thread: HANDED_OVER}
  )

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(textOf(events)).toBe('TEAL')
  expect(recordedIn(events).sessionId).toBe(SESSION_ID)

  await claude.allClosed()
  const [refused, rebuilt] = claude.reports()

  expect(refused?.ended).toBe('refused')
  expect(rebuilt?.args.join(' ')).not.toMatch(/--resume/)
  expect(rebuilt?.prompts[0]).toContain(HANDED_OVER_TURNS)
  expect(events.filter(event => event.type === 'SESSION_REBUILT')).toHaveLength(
    1
  )
})

it('rebuilds from the Thread when claude can’t find the entry to resume at, after the exact restore fails both ways', async () => {
  const claude = await setUp(
    ['warm.ndjson', 'rewound.ndjson', 'rewound.ndjson', 'warm.ndjson'],
    {refuseResumeAt: true}
  )

  const session = await warmThread(claude)

  const events = await claude.reply(
    THIRD_PROMPT,
    {...session, type: 'rewind'},
    {thread: HANDED_OVER}
  )

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  await claude.allClosed()
  const [, fromStore, fromFile, rebuilt] = claude.reports()

  expect(fromStore?.ended).toBe('refused')
  expect(fromFile?.ended).toBe('refused')
  expect(fromFile?.configDir).toBe(claude.configDir)
  expect(rebuilt?.args.join(' ')).not.toMatch(/--resume/)
  expect(rebuilt?.prompts[0]).toContain(HANDED_OVER_TURNS)
})

it('fails the Reply, rebuilding nothing, when claude refuses the session for a Prompt that came with no Thread', async () => {
  const claude = await setUp(['resumed.ndjson', 'warm.ndjson'])

  const events = await claude.reply(FIRST_PROMPT, {
    sessionId: crypto.randomUUID(),
    messageId: crypto.randomUUID(),
  })

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {
      message: expect.stringMatching(/^No conversation found with session ID/),
    },
  })
  expect(claude.reports()).toHaveLength(1)
})

it('rebuilds nothing for a failure that isn’t a lost session', async () => {
  const failing = edited('resumed.ndjson', lines =>
    lines.map(line =>
      line.kind === 'out' && line.message.type === 'result'
        ? {
            ...line,
            message: {...line.message, is_error: true, result: 'Overloaded'},
          }
        : line
    )
  )

  const claude = await setUp(['warm.ndjson', failing, 'warm.ndjson'])
  const first = await claude.reply(FIRST_PROMPT)
  await claude.allClosed()

  const events = await claude.reply(SECOND_PROMPT, recordedIn(first), {
    thread: HANDED_OVER,
  })

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {message: 'Overloaded'},
  })
  expect(claude.reports()).toHaveLength(2)
})
