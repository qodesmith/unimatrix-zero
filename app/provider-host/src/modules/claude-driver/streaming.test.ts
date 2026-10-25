import type {RecordedLine} from './replay'
import type {SDKPartialAssistantMessage} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRecorded, SessionRef} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {fakeStore} from '#modules/test-store/main'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {createClaudeDriver} from './main'
import {RECORDINGS, RecordedLineSchema, replayClaude} from './replay'
import {projectKeyOf} from './transcripts'

/** As `warm.ndjson`, `resumed.ndjson` and `forked.ndjson` recorded them. */
const SESSION_ID = '6b3fb527-e561-4b5c-810d-0ef9ac53978c'
const FIRST_MESSAGE = '62e0dab1-d770-4979-863e-4df4e2be3150'
const SECOND_MESSAGE = '7e7158ab-59c9-4e14-9828-54466ba8084e'
const RESUMED_MESSAGE = '54a838e7-618e-41c6-a747-d57b47a7908e'
const FORKED_SESSION_ID = '830530ec-a381-4e19-98a4-d7383b717af5'
const FORKED_MESSAGE = '1f72cfd4-d1f2-4d35-aa13-f8df39b2bdb1'
const MODEL = 'claude-haiku-5-5'

const IDLE_MS = 300

type Streamed = ReplyEvent | ReplyRecorded

interface Report {
  args: string[]
  configDir: string
  prompts: string[]
  resumedFrom: string[]
  toolResults: string[]
  ended:
    | 'input-closed'
    | 'killed'
    | 'refused'
    | 'exited'
    | `unexpected-${string}`
    | null
}

const cleanUps: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanUp of cleanUps.splice(0).toReversed()) await cleanUp()
})

function folder(prefix: string) {
  const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  cleanUps.push(async () =>
    fs.rmSync(made, {recursive: true, force: true, maxRetries: 10})
  )

  return made
}

function read(name: string): RecordedLine[] {
  return fs
    .readFileSync(path.join(RECORDINGS, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => RecordedLineSchema.parse(JSON.parse(line)))
}

/** Writes a recording changed from one `claude` made, for a case it can't make. */
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

/** Runs the Claude driver against the fake `claude`, which replays `recordings`. */
async function setUp(recordings: string[], env: Record<string, string> = {}) {
  const fake = await replayClaude()
  cleanUps.push(fake.cleanUp)
  const configDir = folder('uz-claude-config-')
  const reports = folder('uz-claude-reports-')
  const store = fakeStore()

  const driver = createClaudeDriver({
    store: store.client,
    env: {
      PATH: process.env.PATH ?? '',
      FAKE_CLAUDE_RECORDINGS: recordings
        .map(name =>
          path.isAbsolute(name) ? name : path.join(RECORDINGS, name)
        )
        .join(path.delimiter),
      FAKE_CLAUDE_REPORTS: reports,
      ...env,
    },
    idleMs: IDLE_MS,
  })

  const treeId = crypto.randomUUID()

  async function reply(
    text: string,
    session: SessionRef | null = null,
    fork = false
  ) {
    return Array.fromAsync<Streamed>(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: 'haiku',
        systemPrompt: '',
        prompt: {text},
        vendorProgram: {
          program: {
            path: fake.program,
            build: {url: 'https://example.com/claude', sha256: '', size: 0},
          },
          configDir,
        },
        session: session && {...session, fork, rewind: false},
      })
    )
  }

  function reportsSoFar(): Report[] {
    return fs
      .readdirSync(reports)
      .toSorted((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map(file =>
        JSON.parse(fs.readFileSync(path.join(reports, file), 'utf8'))
      )
  }

  /** Waits until every `claude` started so far has ended. */
  async function allClosed() {
    await vi.waitFor(
      () => {
        expect(reportsSoFar().every(report => report.ended !== null)).toBe(true)
      },
      {timeout: 5000}
    )
  }

  // Windows can't remove a folder while a `claude` still runs in it.
  cleanUps.push(allClosed)

  return {
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
  return events.filter(
    (event): event is ReplyEvent => event.type !== 'REPLY_RECORDED'
  )
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
  expect(shown(events).contextWindow).toBe(1_000_000)
  // In the app's copy before it was recorded.
  expect(
    claude.store
      .entriesOf(claude.projectKey, SESSION_ID)
      .map(entry => entry.uuid)
  ).toContain(FIRST_MESSAGE)

  await claude.reply(SECOND_PROMPT, recordedIn(events))
  await claude.allClosed()
})

it('continues a Thread in the warm session, then closes it gracefully once idle', async () => {
  const claude = await setUp(['warm.ndjson'])

  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  expect(textOf(second)).toBe('OTTER')
  expect(recordedIn(second)).toEqual({
    sessionId: SESSION_ID,
    messageId: SECOND_MESSAGE,
  })
  expect(shown(second).contextSize).toBe(2 + 0 + 629 + 6)

  await claude.allClosed()
  const [report] = claude.reports()

  expect(claude.reports()).toHaveLength(1)
  expect(report?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT])
  expect(report?.ended).toBe('input-closed')
})

/** Both Replies of `warm.ndjson`, then waits for its `claude` to close. */
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
  const forked = await claude.reply(FORK_PROMPT, first, true)

  // The second Reply never happened on this Branch.
  expect(textOf(forked)).toBe('TEAL')
  expect(recordedIn(forked)).toEqual({
    sessionId: FORKED_SESSION_ID,
    messageId: FORKED_MESSAGE,
  })
  // In the app's copy under its own id, whole, so it resumes on its own.
  expect(
    claude.store
      .entriesOf(claude.projectKey, FORKED_SESSION_ID)
      .map(entry => entry.uuid)
  ).toEqual(expect.arrayContaining([FIRST_MESSAGE, FORKED_MESSAGE]))

  const [, resumed, fork] = claude.reports()

  // The warm `claude` at the end of the other Branch keeps going.
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

it('resumes from the app’s copy when the warm session’s `claude` exited while idle', async () => {
  const claude = await setUp(['warm.ndjson', 'resumed.ndjson'], {
    FAKE_CLAUDE_EXIT_AFTER: '2',
  })

  const first = await claude.reply(FIRST_PROMPT)
  const second = await claude.reply(SECOND_PROMPT, recordedIn(first))

  await vi.waitFor(() => {
    expect(claude.reports()[0]?.ended).toBe('exited')
  })

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
    {FAKE_CLAUDE_REFUSE_STORE: 'yes'}
  )

  const session = await warmThread(claude)

  const third = await claude.reply(THIRD_PROMPT, session)

  expect(textOf(third)).toBe('TEAL OTTER')
  expect(third.at(-1)).toMatchObject({status: 'complete'})

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
    FAKE_CLAUDE_TOOL_RESULT: 'toolu_1.txt',
  })

  const session = await warmThread(claude)

  expect([
    ...claude.store.filesOf(claude.projectKey, SESSION_ID).keys(),
  ]).toEqual(['tool-results/toolu_1.txt'])

  await claude.reply(THIRD_PROMPT, session)
  await claude.allClosed()

  expect(claude.reports()[1]?.toolResults).toEqual(['toolu_1.txt'])
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

/** A stream event `claude` could have written in the recorded session. */
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
  // Not kept warm, so no later Prompt goes to it.
  await claude.allClosed()
  expect(claude.reports()).toHaveLength(1)
})
