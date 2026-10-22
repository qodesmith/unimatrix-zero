import type {ReplyRecorded, ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {fakeStore} from '#modules/test-store/main'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {CODEX_ARGS} from './environment'
import {createCodexDriver} from './main'
import {replayCodex} from './replay'
import {folderOf} from './rollouts'

/** As `started.ndjson` and `resumed.ndjson` recorded them. */
const THREAD_ID = '01a163d2-5139-7a70-abf8-6a5cb5ccebdc'
const FIRST_TURN = '01a163d2-5381-7652-b39d-371b8dbe723c'
const SECOND_TURN = '01a163d2-62e6-7171-ac23-b8feeec8a011'
const RESUMED_TURN = '01a163d2-800d-7fa0-947a-194fc06a1a72'
const MODEL = 'gpt-6.1-sol'
const ROLLOUT = `sessions/2026/10/22/rollout-2026-10-22T09-34-50-${THREAD_ID}.jsonl`

const IDLE_MS = 300

type Streamed = ReplyEvent | ReplyRecorded

interface Report {
  args: string[]
  home: string
  cwd: string
  vendorVariables: string[]
  methods: string[]
  prompts: string[]
  resumedFrom: {type: string; id: string}[]
  /** `input-closed`, `killed`, `refused`, `exited`, or what it didn't expect. */
  ended: string | null
}

const cleanUps: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanUp of cleanUps.splice(0)) await cleanUp()
})

function folder(prefix: string) {
  const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  cleanUps.push(async () => fs.rmSync(made, {recursive: true, force: true}))

  return made
}

/** Runs the Codex driver against the fake `codex`, which replays `recordings`. */
async function setUp(
  recordings: string[],
  {
    store = fakeStore(),
    env = {},
  }: {store?: ReturnType<typeof fakeStore>; env?: Record<string, string>} = {}
) {
  const fake = await replayCodex()
  cleanUps.push(fake.cleanUp)
  const configDir = folder('uz-codex-home-')
  const reports = folder('uz-codex-reports-')

  const driver = createCodexDriver({
    store: store.client,
    commandFor: program => ({command: process.execPath, args: [program]}),
    env: {
      PATH: process.env.PATH ?? '',
      // `bun run test` runs under Electron's own Node: without this, the
      // fake would start as an Electron app and never exit.
      ELECTRON_RUN_AS_NODE: '1',
      OPENAI_API_KEY: 'sk-outranks-the-plan',
      CODEX_HOME: '/Users/sam/.codex',
      FAKE_CODEX_RECORDINGS: recordings
        .map(name => path.join(import.meta.dirname, 'recordings', name))
        .join(path.delimiter),
      FAKE_CODEX_REPORTS: reports,
      ...env,
    },
    idleMs: IDLE_MS,
  })

  const treeId = crypto.randomUUID()

  async function reply(text: string, session: ReplyRequest['session'] = null) {
    return Array.fromAsync<Streamed>(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: 'default',
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text},
        vendorProgram: {
          program: {
            path: path.dirname(fake.program),
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'codex.mjs'},
            },
          },
          configDir,
        },
        session,
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

  /** Waits until every `codex` started so far has ended. */
  async function allClosed() {
    await vi.waitFor(
      () => {
        expect(reportsSoFar().every(report => report.ended !== null)).toBe(true)
      },
      {timeout: 5000}
    )
  }

  return {configDir, store, reply, reports: reportsSoFar, allClosed}
}

function recordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
  )

  if (!recorded) throw new Error('The Reply was not recorded')

  return recorded.session
}

function shown(events: Streamed[]) {
  return events
    .filter((event): event is ReplyEvent => event.type !== 'REPLY_RECORDED')
    .reduce(foldReplyEvent, NEW_REPLY)
}

function textOf(events: Streamed[]) {
  return shown(events)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

const FIRST_PROMPT = 'Say hi in three words.'
const SECOND_PROMPT = 'Now say bye in three words.'
const THIRD_PROMPT = 'What was the first thing I asked you?'

it('streams a Reply, records where Codex saved it, and reports its Context size', async () => {
  const codex = await setUp(['started.ndjson'])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events[0]?.type).toBe('RUN_STARTED')
  expect(events.filter(event => event.type === 'TEXT_DELTA').length).toBe(5)
  expect(textOf(events)).toBe('Hi there, friend!')
  // Provider-reported: what this request sent and wrote.
  expect(shown(events).contextSize).toBe(14_478)
  expect(events.slice(-2)).toEqual([
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      model: MODEL,
      session: {sessionId: THREAD_ID, messageId: FIRST_TURN},
    }),
    expect.objectContaining({type: 'RUN_FINISHED', status: 'complete'}),
  ])
  // In the app's copy before it was recorded, under its name in CODEX_HOME.
  const {projectKey, sessionId} = folderOf(THREAD_ID)

  expect([...codex.store.filesOf(projectKey, sessionId).keys()]).toEqual([
    ROLLOUT,
  ])
})

it('runs codex in its own CODEX_HOME, updater off and nothing that outranks the plan', async () => {
  const codex = await setUp(['started.ndjson'])
  await codex.reply(FIRST_PROMPT)

  const [report] = codex.reports()

  expect(report?.args).toEqual(CODEX_ARGS)
  expect(report?.home).toBe(codex.configDir)
  expect(report?.cwd).toBe(codex.configDir)
  expect(report?.vendorVariables).toEqual(['CODEX_HOME'])
})

it('continues the Thread in the app-server that has it loaded, then closes when idle', async () => {
  const codex = await setUp(['started.ndjson'])

  const first = await codex.reply(FIRST_PROMPT)
  const second = await codex.reply(SECOND_PROMPT, recordedIn(first))

  expect(textOf(second)).toBe('Bye for now!')
  expect(recordedIn(second)).toEqual({
    sessionId: THREAD_ID,
    messageId: SECOND_TURN,
  })

  await codex.allClosed()
  const reports = codex.reports()

  expect(reports).toHaveLength(1)
  expect(reports[0]?.prompts).toEqual([FIRST_PROMPT, SECOND_PROMPT])
  expect(reports[0]?.methods).not.toContain('thread/resume')
  expect(reports[0]?.ended).toBe('input-closed')
})

it('resumes the Thread from the app’s copy alone, written back under its own name', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  // A new CODEX_HOME, with nothing of the thread in it.
  const codex = await setUp(['resumed.ndjson'], {store: opened.store})
  const third = await codex.reply(THIRD_PROMPT, recordedIn(second))

  expect(textOf(third)).toBe('“Say hi in three words.”')
  expect(recordedIn(third)).toEqual({
    sessionId: THREAD_ID,
    messageId: RESUMED_TURN,
  })
  expect(fs.existsSync(path.join(codex.configDir, ...ROLLOUT.split('/')))).toBe(
    true
  )

  const [report] = codex.reports()

  expect(report?.methods).toContain('thread/resume')
  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
  ])
})

it('fails the Reply when the app has no copy of the Thread', async () => {
  const codex = await setUp(['resumed.ndjson'])

  const events = await codex.reply(THIRD_PROMPT, {
    sessionId: THREAD_ID,
    messageId: SECOND_TURN,
  })

  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {
        code: 'provider-error',
        message: `no rollout found for thread id ${THREAD_ID}`,
      },
    })
  )
  expect(events.some(event => event.type === 'REPLY_RECORDED')).toBe(false)
})

it('fails the Reply when a new Codex also stops before answering', async () => {
  const codex = await setUp(['started.ndjson', 'started.ndjson'], {
    env: {FAKE_CODEX_EXIT_AT: 'turn/start'},
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      status: 'failed',
      failure: {
        code: 'provider-error',
        message: 'Codex stopped before it answered.',
      },
    })
  )
  expect(codex.reports().map(report => report.ended)).toEqual([
    'exited',
    'exited',
  ])
})

it('takes the Prompt to a new app-server when the last one stopped unheard', async () => {
  const codex = await setUp(['started.ndjson', 'started.ndjson'], {
    env: {FAKE_CODEX_EXIT_AT: 'turn/start', FAKE_CODEX_EXITS: '1'},
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(textOf(events)).toBe('Hi there, friend!')
  expect(events.at(-1)).toMatchObject({status: 'complete'})
  const [stopped, fresh] = codex.reports()

  expect(stopped?.ended).toBe('exited')
  expect(fresh?.prompts).toEqual([FIRST_PROMPT])
})
