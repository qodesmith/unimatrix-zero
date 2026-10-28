import type {
  PromptRecorded,
  ReplyRecorded,
  ReplyRequest,
  SessionRef,
} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {once} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {CODEX_ARGS} from './environment'
import {createCodexDriver, spawnCodex} from './main'
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

type Streamed = ReplyEvent | PromptRecorded | ReplyRecorded

interface Report {
  args: string[]
  home: string
  cwd: string
  vendorVariables: string[]
  methods: string[]
  prompts: string[]
  resumedFrom: {type: string; id: string}[]
  forkedThrough: string | null
  interrupted: string | null
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
  cleanUps.push(async () => fs.rmSync(made, {recursive: true, force: true}))

  return made
}

function edited(name: string, edit: (text: string) => string) {
  const text = fs.readFileSync(
    path.join(import.meta.dirname, 'recordings', name),
    'utf8'
  )

  const file = path.join(folder('uz-recording-'), name)
  fs.writeFileSync(file, edit(text))

  return file
}

function extendSavedRollout(
  store: ReturnType<typeof fakeStore>,
  configDir: string,
  ...turnIds: string[]
) {
  const {projectKey, sessionId} = folderOf(THREAD_ID)
  const saved = store.filesOf(projectKey, sessionId).get(ROLLOUT)

  if (!saved) throw new Error('The app has no copy of the rollout')

  const file = path.join(configDir, ...ROLLOUT.split('/'))
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(saved.base64, 'base64'),
      ...turnIds.map(id =>
        Buffer.from(`${JSON.stringify({type: 'turn', id})}\n`)
      ),
    ])
  )

  return file
}

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
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []

  const driver = createCodexDriver({
    store: store.client,
    spawn: (command, options) => {
      const child = spawnCodex(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))

      return child
    },
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
    whenIdle: idle.whenIdle,
  })

  const treeId = crypto.randomUUID()

  /** Stops the Reply after `stopAfter` text deltas; 0 stops it as it starts. */
  async function reply(
    text: string,
    session: SessionRef | null = null,
    {
      fork = false,
      rewind = false,
      retryCut,
      stopAfter = Infinity,
    }: {
      fork?: boolean
      rewind?: boolean
      retryCut?: NonNullable<ReplyRequest['session']>['retryCut']
      stopAfter?: number
    } = {}
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
      session: session && {...session, fork, rewind, retryCut},
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

  /** Lets idle time pass, then waits for every `codex` to end. */
  async function allClosed() {
    idle.pass()
    await expect
      .poll(() => reportsSoFar().every(report => report.ended !== null))
      .toBe(true)
  }

  // Windows can't remove a folder while a `codex` still runs in it.
  cleanUps.push(async () => {
    idle.pass()
    await Promise.all(exits)
  })

  return {configDir, store, driver, reply, reports: reportsSoFar, allClosed}
}

function recordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
  )

  if (!recorded) throw new Error('The Reply was not recorded')

  return recorded.session
}

function promptRecordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
  )

  if (!recorded) throw new Error('The Prompt was not recorded')

  return recorded.session
}

function shown(events: Streamed[]) {
  return events
    .filter(
      (event): event is ReplyEvent =>
        event.type !== 'PROMPT_RECORDED' && event.type !== 'REPLY_RECORDED'
    )
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

it('resumes from Codex’s rollout when it carries the app’s copy further, as after a quit mid-Reply', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(['resumed.ndjson'], {store: opened.store})
  extendSavedRollout(opened.store, codex.configDir, 'interrupted')

  await codex.reply(THIRD_PROMPT, recordedIn(second))
  const [report] = codex.reports()

  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
    'interrupted',
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

  // The fork's rollout points into the original's, so both are kept under it.
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
  extendSavedRollout(opened.store, codex.configDir, 'failed')

  const third = await codex.reply(THIRD_PROMPT, recordedIn(second), {
    rewind: true,
  })

  expect(textOf(third)).toBe('“Say hi in three words.”')
  expect(third.at(-1)).toMatchObject({status: 'complete'})

  const [report] = codex.reports()

  expect(report?.methods).toContain('thread/resume')
  expect(report?.methods).not.toContain('thread/revert')
  expect(report?.reverted).toBeNull()
  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
  ])
})

it('cuts a Retry’s loaded thread before the failed turn, keeping the Reply cut short', async () => {
  const codex = await setUp(['reverted.ndjson'])

  const hi = await codex.reply(FIRST_PROMPT)
  const bye = await codex.reply(SECOND_PROMPT, recordedIn(hi))

  await codex.reply(
    'What was the last thing I asked you? Just the words.',
    recordedIn(hi),
    {retryCut: {keepThrough: null, dropFrom: promptRecordedIn(bye).messageId}}
  )

  const [report] = codex.reports()

  expect(report?.reverted).toBe(BYE_TURN)
})

it('cuts a Retry’s unloaded thread before the failed turn, from Codex’s longer rollout, and keeps that rollout', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const reverted = ROLLOUT.replace('.jsonl', '_reverted.jsonl')

  // Codex reports the new rollout once the thread is reverted.
  const resumedThenReverted = edited('resumed.ndjson', text => {
    const lines = text
      .split('\n')
      .map(line =>
        line.includes('"id":4,"result"')
          ? line.replace(path.basename(ROLLOUT), path.basename(reverted))
          : line
      )

    const resumed = lines.findIndex(line => line.includes('"id":2,"result"'))

    return lines
      .toSpliced(
        resumed + 1,
        0,
        JSON.stringify({
          kind: 'in',
          message: {
            id: 99,
            method: 'thread/revert',
            params: {threadId: THREAD_ID, beforeTurnId: 'failed'},
          },
        }),
        JSON.stringify({
          kind: 'out',
          message: {
            id: 99,
            result: {
              thread: {
                id: THREAD_ID,
                path: `/codex-home/${reverted}`,
                forkedFromId: null,
              },
              turnsBackwardsCursor: null,
              itemsBackwardsCursor: null,
            },
          },
        })
      )
      .join('\n')
  })

  const codex = await setUp([resumedThenReverted], {store: opened.store})

  const rollout = extendSavedRollout(
    opened.store,
    codex.configDir,
    'interrupted',
    'failed'
  )

  const onDisk = fs.readFileSync(rollout)

  const retried = await codex.reply(THIRD_PROMPT, recordedIn(second), {
    retryCut: {keepThrough: 'interrupted', dropFrom: 'failed'},
  })

  expect(retried.at(-1)).toMatchObject({status: 'complete'})

  const [report] = codex.reports()

  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
    'interrupted',
    'failed',
  ])
  expect(report?.reverted).toBe('failed')
  const {projectKey, sessionId} = folderOf(THREAD_ID)
  const saved = codex.store.filesOf(projectKey, sessionId).get(ROLLOUT)
  expect(
    Buffer.from(saved?.base64 ?? '', 'base64').subarray(0, onDisk.length)
  ).toEqual(onDisk)
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
  expect(promptRecordedIn(events)).toEqual({
    sessionId: THREAD_ID,
    messageId: FIRST_TURN,
  })
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

it('fails the Reply when the app can’t save its rollout, and still closes Codex once idle', async () => {
  const codex = await setUp(['started.ndjson'], {
    store: fakeStore({'save-files': 'database or disk is full'}),
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.some(event => event.type === 'REPLY_RECORDED')).toBe(false)
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'disk-full'},
  })
  await codex.allClosed()
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
