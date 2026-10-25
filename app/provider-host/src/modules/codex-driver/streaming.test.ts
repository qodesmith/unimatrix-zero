import type {ReplyRecorded, SessionRef} from '@uz/contract/host'
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

/** As `started.ndjson`, `resumed.ndjson` and `forked.ndjson` recorded them. */
const THREAD_ID = '01a168e8-439c-71f2-bbd1-52697c97d40d'
const FIRST_TURN = '01a168e8-4e8e-7312-b51e-dcc3f2d051eb'
const SECOND_TURN = '01a168e8-60f5-71c3-81f4-a35411c1913a'
const RESUMED_TURN = '01a168e8-7ae7-71d3-b6fa-169bec1fd887'
const FORKED_THREAD_ID = '01a168e8-9d25-7df2-b2f4-208bfb1bbd5e'
const FORKED_TURN = '01a168e8-9d50-7fb1-a539-2fd85f3c4b2b'
const MODEL = 'gpt-6.1-sol'
const ROLLOUT = `sessions/2026/10/23/rollout-2026-10-23T09-16-57-${THREAD_ID}.jsonl`
const FORKED_ROLLOUT = `sessions/2026/10/23/rollout-2026-10-23T09-17-17-${FORKED_THREAD_ID}.jsonl`

/** As `stopped.ndjson` recorded them. */
const STOPPED_THREAD_ID = '01a170a9-cc05-7142-8908-96e20ff7d881'
const STOPPED_TURN = '01a170a9-ce9a-7972-abbb-60582c32b871'
const AFTER_STOP_TURN = '01a170a9-de52-7e32-98fa-57fc6eeb8640'
const STOPPED_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-39-${STOPPED_THREAD_ID}.jsonl`

/** As `reverted.ndjson` recorded them. */
const REWOUND_THREAD_ID = '01a170a9-f825-72a1-bba2-c0fac2f606fd'
const HI_TURN = '01a170a9-fa94-7543-b644-2fe7cf5a34fc'
const BYE_TURN = '01a170aa-0e03-7b72-8de6-8e269c1f5388'
const RETRIED_TURN = '01a170aa-1476-75b0-892c-bd4587e4d57b'
const REWOUND_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-50-${REWOUND_THREAD_ID}.jsonl`
const REVERTED_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-56-${REWOUND_THREAD_ID}_01a170aa-145c-7992-b8a7-bcfb762e8621.jsonl`

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
  /** The `lastTurnId` of a `thread/fork`. */
  forkedThrough: string | null
  /** The `turnId` of a `turn/interrupt`. */
  interrupted: string | null
  /** The `beforeTurnId` of a `thread/revert`. */
  reverted: string | null
  /** `input-closed`, `killed`, `refused`, `exited`, or what it didn't expect. */
  ended: string | null
}

const cleanUps: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.useRealTimers()

  for (const cleanUp of cleanUps.splice(0).toReversed()) await cleanUp()
})

function folder(prefix: string) {
  const made = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  cleanUps.push(async () =>
    fs.rmSync(made, {recursive: true, force: true, maxRetries: 10})
  )

  return made
}

/** A copy of the recording `name`, its text as `edit` changes it. */
function edited(name: string, edit: (text: string) => string) {
  const text = fs.readFileSync(
    path.join(import.meta.dirname, 'recordings', name),
    'utf8'
  )

  const file = path.join(folder('uz-recording-'), name)
  fs.writeFileSync(file, edit(text))

  return file
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
        .map(name =>
          path.isAbsolute(name)
            ? name
            : path.join(import.meta.dirname, 'recordings', name)
        )
        .join(path.delimiter),
      FAKE_CODEX_REPORTS: reports,
      ...env,
    },
    idleMs: IDLE_MS,
  })

  const treeId = crypto.randomUUID()

  /**
   * Streams a Reply to its end, stopping it after `stopAfter` text deltas; 0
   * stops it as it starts.
   */
  async function reply(
    text: string,
    session: SessionRef | null = null,
    {fork = false, rewind = false, stopAfter = Infinity} = {}
  ) {
    const replyId = crypto.randomUUID()
    const events: Streamed[] = []
    let deltas = 0

    for await (const event of driver.startReply({
      treeId,
      replyId,
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
      session: session && {...session, fork, rewind},
    })) {
      events.push(event)

      if (
        (event.type === 'RUN_STARTED' && stopAfter === 0) ||
        (event.type === 'TEXT_DELTA' && ++deltas === stopAfter)
      ) {
        await driver.stop(replyId)
      }
    }

    return events
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

  // Windows can't remove a folder while a `codex` still runs in it.
  cleanUps.push(allClosed)

  return {configDir, store, driver, reply, reports: reportsSoFar, allClosed}
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
const FORK_PROMPT = 'What was the last thing I asked you?'

it('streams a Reply, records where Codex saved it, and reports its Context size', async () => {
  const codex = await setUp(['started.ndjson'])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events[0]?.type).toBe('RUN_STARTED')
  expect(events.filter(event => event.type === 'TEXT_DELTA').length).toBe(5)
  expect(textOf(events)).toBe('Hi there, friend!')
  expect(shown(events).contextSize).toBe(14_487)
  expect(shown(events).contextWindow).toBe(475_000)
  expect(events.slice(-2)).toEqual([
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      model: MODEL,
      session: {sessionId: THREAD_ID, messageId: FIRST_TURN},
    }),
    expect.objectContaining({type: 'RUN_FINISHED', status: 'complete'}),
  ])
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

it('continues the Provider session in the app-server that has it loaded, then closes when idle', async () => {
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

it('resumes the Provider session from the app’s copy alone, written back under its own name', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

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

it('forks the Provider session through a mid-Thread Reply into a new thread, from the app’s copy alone', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(['forked.ndjson'], {store: opened.store})

  const forked = await codex.reply(FORK_PROMPT, recordedIn(first), {
    fork: true,
  })

  // The second Reply never happened on this Branch.
  expect(textOf(forked)).toBe('You asked: “Say hi in three words.”')
  expect(recordedIn(forked)).toEqual({
    sessionId: FORKED_THREAD_ID,
    messageId: FORKED_TURN,
  })

  const [report] = codex.reports()

  expect(report?.methods).not.toContain('thread/resume')
  expect(report?.forkedThrough).toBe(FIRST_TURN)
  // Written back whole for Codex to fork; the fork is Codex's to cut.
  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
  ])

  // The fork's rollout, and the original's it points into, are kept under the fork.
  const fork = folderOf(FORKED_THREAD_ID)

  expect([
    ...codex.store.filesOf(fork.projectKey, fork.sessionId).keys(),
  ]).toEqual([FORKED_ROLLOUT, ROLLOUT])

  const original = folderOf(THREAD_ID)

  expect([
    ...codex.store.filesOf(original.projectKey, original.sessionId).keys(),
  ]).toEqual([ROLLOUT])
})

it('passes on a stop asked before Codex has started the turn', async () => {
  const codex = await setUp(['stopped.ndjson'])

  const stopped = await codex.reply(
    'Count from 1 to 300, one number per line.',
    null,
    {stopAfter: 0}
  )

  expect(stopped.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'stopped',
  })
  expect(codex.reports()[0]?.interrupted).toBe(STOPPED_TURN)
})

it('stops a Reply where it is, records it, and continues the Provider session after it', async () => {
  const codex = await setUp(['stopped.ndjson'])

  const stopped = await codex.reply(
    'Count from 1 to 300, one number per line.',
    null,
    {
      stopAfter: 5,
    }
  )

  expect(textOf(stopped)).toBe('1\n2\n3\n4\n5\n6\n7\n')
  expect(shown(stopped).status).toBe('stopped')
  expect(stopped.slice(-2)).toEqual([
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      session: {sessionId: STOPPED_THREAD_ID, messageId: STOPPED_TURN},
    }),
    expect.objectContaining({type: 'RUN_FINISHED', status: 'stopped'}),
  ])
  const {projectKey, sessionId} = folderOf(STOPPED_THREAD_ID)

  expect([...codex.store.filesOf(projectKey, sessionId).keys()]).toEqual([
    STOPPED_ROLLOUT,
  ])

  const continued = await codex.reply(
    'What did I ask you to do? Answer in five words.',
    recordedIn(stopped)
  )

  expect(textOf(continued)).toBe('Count one through three hundred.')
  expect(continued.at(-1)).toMatchObject({status: 'complete'})
  expect(recordedIn(continued)).toEqual({
    sessionId: STOPPED_THREAD_ID,
    messageId: AFTER_STOP_TURN,
  })

  await codex.allClosed()
  const [report] = codex.reports()

  expect(report?.interrupted).toBe(STOPPED_TURN)
  expect(report?.ended).toBe('input-closed')
})

it('stops nothing for a Reply it isn’t writing', async () => {
  const codex = await setUp(['started.ndjson'])

  await expect(codex.driver.stop(crypto.randomUUID())).resolves.toBeUndefined()

  expect(codex.reports()).toEqual([])
})

it('rewinds the loaded thread to the Reply a Retry answers, keeping both rollouts', async () => {
  const codex = await setUp(['reverted.ndjson'])

  const hi = await codex.reply(FIRST_PROMPT)
  const bye = await codex.reply(SECOND_PROMPT, recordedIn(hi))

  expect(recordedIn(hi)).toEqual({
    sessionId: REWOUND_THREAD_ID,
    messageId: HI_TURN,
  })
  expect(recordedIn(bye)).toEqual({
    sessionId: REWOUND_THREAD_ID,
    messageId: BYE_TURN,
  })

  const retried = await codex.reply(
    'What was the last thing I asked you? Just the words.',
    recordedIn(hi),
    {rewind: true}
  )

  expect(textOf(retried)).toBe('Say hi in three words.')
  expect(recordedIn(retried)).toEqual({
    sessionId: REWOUND_THREAD_ID,
    messageId: RETRIED_TURN,
  })

  const [report] = codex.reports()

  expect(report?.methods).toContain('thread/revert')
  expect(report?.reverted).toBe(BYE_TURN)
  const {projectKey, sessionId} = folderOf(REWOUND_THREAD_ID)

  expect([...codex.store.filesOf(projectKey, sessionId).keys()]).toEqual([
    REWOUND_ROLLOUT,
    REVERTED_ROLLOUT,
  ])
})

it('resumes a Retry from the app’s copy when the thread isn’t loaded, with nothing to revert', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(['resumed.ndjson'], {store: opened.store})

  const third = await codex.reply(THIRD_PROMPT, recordedIn(second), {
    rewind: true,
  })

  expect(textOf(third)).toBe('“Say hi in three words.”')
  expect(third.at(-1)).toMatchObject({status: 'complete'})

  const [report] = codex.reports()

  expect(report?.methods).toContain('thread/resume')
  expect(report?.methods).not.toContain('thread/revert')
  expect(report?.reverted).toBeNull()
})

it('fails the Reply when the app has no copy of the Provider session', async () => {
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
        code: 'program-crashed',
        message: 'Codex stopped before it answered.',
      },
    })
  )
  expect(codex.reports().map(report => report.ended)).toEqual([
    'exited',
    'exited',
  ])
})

it('fails the Reply as a crash, keeping its text, when Codex stops mid-stream', async () => {
  const codex = await setUp(['started.ndjson'], {
    env: {FAKE_CODEX_EXIT_AT: 'thread/tokenUsage/updated'},
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(textOf(events)).toBe('Hi there, friend!')
  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      status: 'failed',
      failure: {
        code: 'program-crashed',
        message: 'Codex stopped before finishing this Reply.',
      },
    })
  )
  expect(events.some(event => event.type === 'REPLY_RECORDED')).toBe(false)
  expect(codex.reports()).toHaveLength(1)
})

it('names when a limit lifts by the full window Codex reported', async () => {
  const limited = edited('started.ndjson', text =>
    text
      .replace('"usedPercent":0', '"usedPercent":100')
      .replace(
        '"status":"completed","error":null',
        '"status":"failed","error":{"message":"You’ve hit your usage limit."}'
      )
  )

  vi.useFakeTimers({toFake: ['Date'], now: new Date('2026-10-23T09:00:00Z')})
  const codex = await setUp([limited])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'limit-reached', resetsAt: '2026-10-29T18:43:34.000Z'},
  })
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
