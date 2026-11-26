import type {FakeCodexOptions} from './replay'
import type {HostAttachment} from '@uz/contract/attachments'
import type {
  PromptRecorded,
  ReplyRecorded,
  ReplySession,
  SessionRef,
  SignInRequest,
  StartReplyEvent,
  Thread,
} from '@uz/contract/host'
import type {ApprovalGrant, PermissionMode} from '@uz/contract/permissions'
import type {CompactionSettings} from '@uz/contract/settings'
import type {TreeTools} from '@uz/contract/tools'
import type {ApprovalAnswer} from '@uz/contract/turns'

import {
  PNG_BASE64,
  SHRUNK_BASE64,
  attachedFiles,
  byPathOnly,
} from '#modules/test-attachments/main'
import {heldIdle} from '#modules/test-idle/main'
import {fakeStore} from '#modules/test-store/main'
import {explainingLabels} from '#modules/thread-replay/main'
import {isReplyEvent} from '@uz/contract/host'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {once} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, expect, it, vi} from 'vitest'

import {createCodexDriver, spawnCodex} from './main'
import {
  FakeCodexRunSchema,
  RECORDINGS,
  fakeCodexEnv,
  replayCodex,
} from './replay'
import {folderOf} from './rollouts'

const THREAD_ID = '01a168e8-439c-71f2-bbd1-52697c97d40d'
const FIRST_TURN = '01a168e8-4e8e-7312-b51e-dcc3f2d051eb'
const SECOND_TURN = '01a168e8-60f5-71c3-81f4-a35411c1913a'
const RESUMED_TURN = '01a168e8-7ae7-71d3-b6fa-169bec1fd887'
const FORKED_THREAD_ID = '01a168e8-9d25-7df2-b2f4-208bfb1bbd5e'
const FORKED_TURN = '01a168e8-9d50-7fb1-a539-2fd85f3c4b2b'
const MODEL = 'gpt-6.1-sol'

const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  threshold: null,
}

const ROLLOUT = `sessions/2026/10/23/rollout-2026-10-23T09-16-57-${THREAD_ID}.jsonl`
const FORKED_ROLLOUT = `sessions/2026/10/23/rollout-2026-10-23T09-17-17-${FORKED_THREAD_ID}.jsonl`

const STOPPED_THREAD_ID = '01a170a9-cc05-7142-8908-96e20ff7d881'
const STOPPED_TURN = '01a170a9-ce9a-7972-abbb-60582c32b871'
const AFTER_STOP_TURN = '01a170a9-de52-7e32-98fa-57fc6eeb8640'
const STOPPED_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-39-${STOPPED_THREAD_ID}.jsonl`

const REWOUND_THREAD_ID = '01a170a9-f825-72a1-bba2-c0fac2f606fd'
const HI_TURN = '01a170a9-fa94-7543-b644-2fe7cf5a34fc'
const BYE_TURN = '01a170aa-0e03-7b72-8de6-8e269c1f5388'
const RETRIED_TURN = '01a170aa-1476-75b0-892c-bd4587e4d57b'
const REWOUND_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-50-${REWOUND_THREAD_ID}.jsonl`
const REVERTED_ROLLOUT = `sessions/2026/10/24/rollout-2026-10-24T21-25-56-${REWOUND_THREAD_ID}_01a170aa-145c-7992-b8a7-bcfb762e8621.jsonl`

const THANKED_THREAD_ID = '01a1893a-31f8-76f2-8050-38ee9d75c720'
const HELLO_TURN = '01a1893a-3439-7c23-9c2d-69d52b12a8b4'
const GOODBYE_TURN = '01a1893a-4532-7b33-804e-21ff70011737'
const THANKS_TURN = '01a1893a-4f0d-71a0-9828-93cd3ea3291e'

const RECONNECTED_THREAD_ID = '01a1c264-7cf0-7403-a69a-cdef675814f6'
const RECONNECTED_TURN = '01a1c264-7f60-77f1-8637-990e960884d7'

const COMPACTED_THREAD_ID = '01a1c55f-23dd-7593-a186-df8b3a434f75'

type Streamed = StartReplyEvent

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

/** What the default Tools panel turns off, which Codex has on by default. */
const DEFAULT_TOOLS_OFF = {
  'skills.bundled.enabled': false,
  'features.plugins': false,
  'features.apps': false,
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

const SYSTEM_PROMPT = 'You answer in as few words as you can.'

async function setUp(
  recordings: string[],
  {
    store = fakeStore(),
    platform = 'darwin',
    readLoginShellPath = async () => undefined,
    ...behavior
  }: {
    store?: ReturnType<typeof fakeStore>
    platform?: NodeJS.Platform
    readLoginShellPath?: () => Promise<string | undefined>
  } & FakeCodexOptions = {}
) {
  const fake = await replayCodex()
  cleanUps.push(fake.cleanUp)
  const configDir = folder('uz-codex-home-')
  const treeFolder = folder('uz-codex-tree-')
  const reports = folder('uz-codex-reports-')
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const environments: NodeJS.ProcessEnv[] = []
  const developerTools = {present: true}

  const driver = createCodexDriver({
    store: store.client,
    hasDeveloperTools: async () => developerTools.present,
    readLoginShellPath,
    platform,
    spawn: (command, options) => {
      environments.push(options.env)
      const child = spawnCodex(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))

      return child
    },
    commandFor: program => ({command: process.execPath, args: [program]}),
    env: {
      PATH: process.env.PATH ?? '',
      // Tests run under Electron's Node; without this the fake never exits.
      ELECTRON_RUN_AS_NODE: '1',
      OPENAI_API_KEY: 'sk-outranks-the-plan',
      CODEX_HOME: '/Users/sam/.codex',
      ...fakeCodexEnv(
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

  const vendorProgram: SignInRequest = {
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
    developerDir: path.join(configDir, 'developer'),
    gitFolder: path.join(configDir, 'git'),
  }

  async function reply(
    text: string,
    session: SessionRef | ReplySession | null = null,
    {
      stopAfter = Infinity,
      model = MODEL,
      compactionSettings = DEFAULT_COMPACTION_SETTINGS,
      thread = [],
      attachments = [],
      systemPromptChanged = false,
      tools = DEFAULT_TREE_TOOLS,
      ...asking
    }: {
      stopAfter?: number
      model?: string
      compactionSettings?: CompactionSettings
      thread?: Thread
      attachments?: HostAttachment[]
      systemPromptChanged?: boolean
      tools?: TreeTools
      permissionMode?: PermissionMode
      grants?: ApprovalGrant[]
      /** Each card's answer; `stop` stops the Reply instead. */
      answer?: ApprovalAnswer | 'stop'
      inTree?: string
    } = {}
  ) {
    const {permissionMode, grants, answer, inTree} = {
      permissionMode: 'full-access',
      grants: [],
      answer: 'allow-once',
      inTree: treeId,
      ...asking,
    } satisfies typeof asking

    const replyId = crypto.randomUUID()
    const events: Streamed[] = []
    let deltas = 0

    for await (const event of driver.startReply({
      treeId: inTree,
      replyId,
      model,
      systemPrompt: SYSTEM_PROMPT,
      prompt: {text, attachments, messageId: crypto.randomUUID()},
      vendorProgram,
      treeFolder,
      session: session && {type: 'continue', ...session},
      thread,
      compactionSettings,
      systemPromptChanged,
      tools,
      permissionMode,
      grants,
    })) {
      events.push(event)

      if (event.type === 'TEXT_DELTA' && ++deltas === stopAfter) {
        await driver.stop(replyId)
      }

      if (event.type === 'APPROVAL_REQUESTED') {
        await answerCard(replyId, event.approvalId, answer)
      }
    }

    return events
  }

  async function answerCard(
    replyId: string,
    approvalId: string,
    answer: ApprovalAnswer | 'stop'
  ) {
    await (answer === 'stop'
      ? driver.stop(replyId)
      : driver.answerApproval(approvalId, answer))
  }

  function reportsSoFar() {
    return fs
      .readdirSync(reports)
      .toSorted((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
      .map(file =>
        FakeCodexRunSchema.parse(
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

  // Windows can't remove a folder while a `codex` still runs in it.
  cleanUps.push(async () => {
    idle.pass()
    await Promise.all(exits)
  })

  async function cut(sessionId: string, keptTurn: string, dropFrom: string) {
    return driver.cutSession({
      session: {
        type: 'cut',
        sessionId,
        messageId: keptTurn,
        keepThrough: keptTurn,
        dropFrom,
      },
      vendorProgram,
    })
  }

  return {
    configDir,
    treeFolder,
    store,
    driver,
    vendorProgram,
    reply,
    cut,
    reports: reportsSoFar,
    environments,
    developerTools,
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

function promptRecordedIn(events: Streamed[]) {
  const recorded = events.find(
    (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
  )

  if (!recorded) throw new Error('The Prompt was not recorded')

  return recorded.session
}

function droppedIn(events: Streamed[]) {
  return events.some(event => event.type === 'PROMPT_DROPPED')
}

function shown(events: Streamed[]) {
  return events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY)
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

it('shows a file change and a command as tool calls with their results, the text after them a part of its own', async () => {
  const codex = await setUp(['tools.ndjson'])
  const events = await codex.reply('Write notes.txt, then cat it.')

  expect(shown(events).content).toEqual([
    {type: 'text', text: 'I’ll create the file, then read it in the shell.\n'},
    {
      type: 'tool-call',
      toolCallId: expect.any(String),
      toolName: 'fileChange',
      args: expect.stringContaining('notes.txt'),
      result: {
        content: expect.stringMatching(/^add \S+\/notes\.txt$/),
        isError: false,
      },
    },
    {
      type: 'tool-call',
      toolCallId: expect.any(String),
      toolName: 'commandExecution',
      args: expect.stringContaining('cat notes.txt'),
      result: {content: 'HERON\n', isError: false},
    },
    {type: 'text', text: 'HERON'},
  ])
  expect(events.at(-1)).toMatchObject({status: 'complete'})
})

it('runs codex in its own CODEX_HOME, updater off and nothing that outranks the plan', async () => {
  const codex = await setUp(['started.ndjson'])
  await codex.reply(FIRST_PROMPT)

  const [report] = codex.reports()

  expect(report?.args.join(' ')).toContain(
    '-c check_for_update_on_startup=false'
  )
  expect(report?.home).toBe(codex.configDir)
  expect(report?.cwd).toBe(codex.configDir)
  expect(report?.vendorVariables).toEqual(['CODEX_HOME'])
})

it('starts codex with project docs off and in its own `CODEX_HOME`, so neither an `AGENTS.md` nor the user’s `config.toml` loads', async () => {
  const codex = await setUp(['started.ndjson'])
  await codex.reply(FIRST_PROMPT)

  const [report] = codex.reports()

  expect(report?.args.join(' ')).toContain('-c project_doc_max_bytes=0')
  expect(report?.home).toBe(codex.configDir)
})

it('starts codex with Subagents off', async () => {
  const codex = await setUp(['started.ndjson'])
  await codex.reply(FIRST_PROMPT)

  const args = codex.reports()[0]?.args.join(' ')

  expect(args).toContain('-c features.multi_agent=false')
  expect(args).toContain('-c agents.enabled=false')
})

it('names the app’s developer folder to an app-server that starts on a Mac with no developer tools, and to none that starts on a Mac with them', async () => {
  const codex = await setUp(['started.ndjson', 'started.ndjson'])

  await codex.reply(FIRST_PROMPT)
  await codex.allClosed()
  codex.developerTools.present = false
  await codex.reply(FIRST_PROMPT)

  expect(codex.environments.map(env => env.DEVELOPER_DIR)).toEqual([
    undefined,
    codex.vendorProgram.developerDir,
  ])
  // Git's own folders are named inside the folder's script, for one call.
  expect(
    codex.environments.flatMap(env =>
      Object.keys(env).filter(name => name.startsWith('GIT_'))
    )
  ).toEqual([])

  await codex.allClosed()
})

it('puts the folder of the app’s own git last on the PATH of the app-server, and names none of git’s own folders', async () => {
  const codex = await setUp(['started.ndjson'])

  await codex.reply(FIRST_PROMPT)

  expect(codex.environments.map(env => env.PATH)).toEqual([
    `${process.env.PATH ?? ''}${path.delimiter}${codex.vendorProgram.gitFolder}`,
  ])
  expect(
    codex.environments.flatMap(env =>
      Object.keys(env).filter(name => name.startsWith('GIT_'))
    )
  ).toEqual([])

  await codex.allClosed()
})

it('gives the app-server on Linux the PATH the user’s login shell sets, read once, with the app’s own folder last, and leaves other platforms’ PATH alone', async () => {
  const loginPath = ['/home/sam/.local/bin', '/usr/bin'].join(path.delimiter)
  const own = process.env.PATH ?? ''
  let reads = 0

  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    const codex = await setUp(['started.ndjson', 'started.ndjson'], {
      platform,
      readLoginShellPath: async () => {
        reads += 1

        return loginPath
      },
    })

    await codex.reply(FIRST_PROMPT)
    await codex.allClosed()
    await codex.reply(FIRST_PROMPT)
    await codex.allClosed()

    const first = platform === 'linux' ? loginPath : own
    const expected = `${first}${path.delimiter}${codex.vendorProgram.gitFolder}`

    expect(codex.environments.map(env => env.PATH)).toEqual([
      expected,
      expected,
    ])
  }

  expect(reads).toBe(1)
})

it('tells the app-server to run commands without a login shell on Linux, and on no other platform', async () => {
  const settings: boolean[] = []

  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    const codex = await setUp(['started.ndjson'], {platform})
    await codex.reply(FIRST_PROMPT)
    const [report] = codex.reports()
    settings.push(
      report?.args.join(' ').includes('-c allow_login_shell=false') ?? false
    )
    await codex.allClosed()
  }

  expect(settings).toEqual([true, false, false])
})

it('gives the app-server none of git’s login settings, on any platform', async () => {
  const prompts: (string | undefined)[][] = []

  for (const platform of ['linux', 'darwin', 'win32'] as const) {
    const codex = await setUp(['started.ndjson'], {platform})
    await codex.reply(FIRST_PROMPT)
    const [env] = codex.environments
    prompts.push([env?.GCM_INTERACTIVE, env?.GIT_TERMINAL_PROMPT])
    await codex.allClosed()
  }

  expect(prompts).toEqual([
    [undefined, undefined],
    [undefined, undefined],
    [undefined, undefined],
  ])
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

it('resumes the Provider session from the app’s copy alone, written back under its own name, with no Compaction limit in its config for the default threshold', async () => {
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
  expect(report?.threadConfigs).toEqual([DEFAULT_TOOLS_OFF])
  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
  ])
})

it('reports only its own turn’s token count, not the one a resume repeats or another Provider session’s', async () => {
  const crossed = edited('resumed.ndjson', text => {
    const lines = text.split('\n')

    const at = lines.findIndex(line =>
      line.includes(`"turnId":"${RESUMED_TURN}","tokenUsage"`)
    )

    const otherThread = lines[at]
      ?.replaceAll(THREAD_ID, FORKED_THREAD_ID)
      .replaceAll(RESUMED_TURN, FORKED_TURN)

    if (otherThread === undefined) throw new Error('No token count to copy')

    return lines.toSpliced(at, 0, otherThread).join('\n')
  })

  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp([crossed], {store: opened.store})
  const third = await codex.reply(THIRD_PROMPT, recordedIn(second))

  expect(third.filter(event => event.type === 'TOKENS')).toEqual([
    expect.objectContaining({contextSize: 16_789}),
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

it('forks the Provider session through a mid-Thread Reply into a new thread with the Compaction threshold, from the app’s copy alone', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(['forked.ndjson'], {store: opened.store})

  const forked = await codex.reply(
    FORK_PROMPT,
    {...recordedIn(first), type: 'fork'},
    {compactionSettings: {auto: true, threshold: 30_000}}
  )

  expect(textOf(forked)).toBe('You asked: “Say hi in three words.”')
  expect(recordedIn(forked)).toEqual({
    sessionId: FORKED_THREAD_ID,
    messageId: FORKED_TURN,
  })

  const [report] = codex.reports()

  expect(report?.methods).not.toContain('thread/resume')
  expect(report?.forkedThrough).toBe(FIRST_TURN)
  expect(report?.threadConfigs).toEqual([
    {model_auto_compact_token_limit: 30_000, ...DEFAULT_TOOLS_OFF},
  ])
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

it('shows only the message Codex starts over after a dropped connection', async () => {
  const codex = await setUp(['reconnected.ndjson'])

  const events = await codex.reply(
    'Make up a three-word ship name, put it on the first line, then write the numbers 1 to 50, one per line.'
  )

  expect(textOf(events)).toBe(
    ['Silver Moon Voyager', ...Array.from({length: 50}, (_, i) => i + 1)].join(
      '\n'
    )
  )
  expect(shown(events).status).toBe('complete')
  expect(recordedIn(events)).toEqual({
    sessionId: RECONNECTED_THREAD_ID,
    messageId: RECONNECTED_TURN,
  })
})

function compactionsIn(events: Streamed[]) {
  return events.filter(event => event.type === 'CONTEXT_COMPACTED')
}

async function compactingThread(recording: string) {
  const codex = await setUp([recording])
  const filled = await codex.reply('Reply with the single word TEAL.')

  const compacting = await codex.reply(
    'Reply with the single word OTTER.',
    recordedIn(filled)
  )

  await codex.allClosed()

  return {filled, compacting}
}

it('starts a thread with no Compaction limit in its config for the default threshold', async () => {
  const codex = await setUp(['started.ndjson'])
  await codex.reply('Reply with the single word TEAL.')
  await codex.allClosed()

  expect(codex.reports()[0]?.threadConfigs).toEqual([DEFAULT_TOOLS_OFF])
})

it('unsubscribes a loaded thread and resumes it with a changed Compaction threshold', async () => {
  const codex = await setUp(['compaction-settings.ndjson'])

  const padded = await codex.reply('Reply with the single word TEAL.', null, {
    compactionSettings: {auto: true, threshold: 30_000},
  })

  const under = await codex.reply(
    'Reply with the single word OTTER.',
    recordedIn(padded),
    {compactionSettings: {auto: true, threshold: 30_000}}
  )

  const lowered = await codex.reply(
    'Reply with the single word HERON.',
    recordedIn(under),
    {compactionSettings: {auto: true, threshold: 20_000}}
  )

  await codex.allClosed()
  const [report] = codex.reports()

  expect(report?.threadConfigs).toEqual([
    {model_auto_compact_token_limit: 30_000, ...DEFAULT_TOOLS_OFF},
    {model_auto_compact_token_limit: 20_000, ...DEFAULT_TOOLS_OFF},
  ])
  expect(
    report?.methods.filter(method => method.startsWith('thread/'))
  ).toEqual([
    'thread/start',
    'thread/read',
    'thread/read',
    'thread/unsubscribe',
    'thread/resume',
    'thread/read',
  ])
  expect(compactionsIn(lowered)).toHaveLength(1)
  expect(textOf(lowered)).toBe('HERON')
})

it('turns web search, built-in Skills and remote plugins on or off as the Tools panel says, unsubscribing a loaded thread to change them', async () => {
  const codex = await setUp(['compaction-settings.ndjson'])
  const lowered = {compactionSettings: {auto: true, threshold: 30_000}}

  const padded = await codex.reply(
    'Reply with the single word TEAL.',
    null,
    lowered
  )

  const under = await codex.reply(
    'Reply with the single word OTTER.',
    recordedIn(padded),
    lowered
  )

  const flipped = await codex.reply(
    'Reply with the single word HERON.',
    recordedIn(under),
    {
      ...lowered,
      tools: {
        ...DEFAULT_TREE_TOOLS,
        webSearch: false,
        chatgptBuiltInSkills: true,
        chatgptRemotePlugins: true,
      },
    }
  )

  await codex.allClosed()
  const [report] = codex.reports()

  expect(report?.threadConfigs).toEqual([
    {
      model_auto_compact_token_limit: 30_000,
      ...DEFAULT_TOOLS_OFF,
    },
    {
      model_auto_compact_token_limit: 30_000,
      web_search: 'disabled',
      'skills.bundled.enabled': true,
      'features.plugins': true,
      'features.apps': true,
    },
  ])
  expect(
    report?.methods.filter(method => method.startsWith('thread/'))
  ).toEqual([
    'thread/start',
    'thread/read',
    'thread/read',
    'thread/unsubscribe',
    'thread/resume',
    'thread/read',
  ])
  expect(textOf(flipped)).toBe('HERON')
})

it('loads a thread again with no Compaction limit in its config to go back to Codex’s default', async () => {
  const codex = await setUp(['compaction-settings.ndjson'])
  const lowered = {compactionSettings: {auto: true, threshold: 30_000}}

  const padded = await codex.reply(
    'Reply with the single word TEAL.',
    null,
    lowered
  )

  const under = await codex.reply(
    'Reply with the single word OTTER.',
    recordedIn(padded),
    lowered
  )

  await codex.reply('Reply with the single word HERON.', recordedIn(under))
  await codex.allClosed()

  expect(codex.reports()[0]?.threadConfigs).toEqual([
    {model_auto_compact_token_limit: 30_000, ...DEFAULT_TOOLS_OFF},
    DEFAULT_TOOLS_OFF,
  ])
})

it('reports a compaction Codex made inside a turn, with the thread it compacted', async () => {
  const {filled, compacting} = await compactingThread('compacted.ndjson')

  expect(compactionsIn(compacting)).toEqual([
    expect.objectContaining({
      sessionId: COMPACTED_THREAD_ID,
      boundaryId: null,
    }),
  ])
  expect(textOf(compacting)).toBe('OTTER')
  expect(compactionsIn(filled)).toEqual([])
})

it('reports no compaction for one Codex started and never finished, as when it fails', async () => {
  const unfinished = edited('compacted.ndjson', text =>
    text
      .split('\n')
      .filter(
        line =>
          !line.includes('"method":"item/completed"') ||
          !line.includes('"type":"contextCompaction"')
      )
      .join('\n')
  )

  const {compacting} = await compactingThread(unfinished)

  expect(compactionsIn(compacting)).toEqual([])
  expect(textOf(compacting)).toBe('OTTER')
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

  const oldRollout = path.join(codex.configDir, ...REWOUND_ROLLOUT.split('/'))
  fs.appendFileSync(oldRollout, `${JSON.stringify({type: 'written-after'})}\n`)
  const onDisk = fs.readFileSync(oldRollout)

  const retried = await codex.reply(
    'What was the last thing I asked you? Just the words.',
    {...recordedIn(hi), type: 'rewind'}
  )

  expect(textOf(retried)).toBe('Say hi in three words.')
  expect(recordedIn(retried)).toEqual({
    sessionId: REWOUND_THREAD_ID,
    messageId: RETRIED_TURN,
  })

  const [report] = codex.reports()

  expect(report?.reverted).toBe(BYE_TURN)
  const {projectKey, sessionId} = folderOf(REWOUND_THREAD_ID)
  const kept = codex.store.filesOf(projectKey, sessionId)

  expect([...kept.keys()]).toEqual([REWOUND_ROLLOUT, REVERTED_ROLLOUT])
  expect(
    Buffer.from(kept.get(REWOUND_ROLLOUT)?.base64 ?? '', 'base64')
  ).toEqual(onDisk)
})

function retriedTwice() {
  return edited('reverted.ndjson', text => {
    const lines = text.split('\n').filter(Boolean)

    const retry = lines.findIndex(line =>
      line.includes('"method":"thread/revert"')
    )

    const end = lines.findIndex(line => line === '{"kind":"end"}')

    return [
      ...lines.slice(0, end),
      ...lines.slice(retry, end),
      ...lines.slice(end),
    ].join('\n')
  })
}

it('rewinds a loaded thread past the first Retry’s Reply when the same Reply is retried again', async () => {
  const codex = await setUp([retriedTwice()])
  const hi = await codex.reply(FIRST_PROMPT)
  await codex.reply(SECOND_PROMPT, recordedIn(hi))
  const retry = {...recordedIn(hi), type: 'rewind'} as const
  const prompt = 'What was the last thing I asked you? Just the words.'

  await codex.reply(prompt, retry)
  const again = await codex.reply(prompt, retry)

  expect(again.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.reverted).toBe(RETRIED_TURN)
})

it('resumes a Retry from the app’s copy when the thread isn’t loaded, with nothing to revert', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(['resumed.ndjson'], {store: opened.store})
  extendSavedRollout(opened.store, codex.configDir, 'failed')

  const third = await codex.reply(THIRD_PROMPT, {
    ...recordedIn(second),
    type: 'rewind',
  })

  expect(textOf(third)).toBe('“Say hi in three words.”')
  expect(third.at(-1)).toMatchObject({status: 'complete'})

  const [report] = codex.reports()

  expect(report?.methods).toContain('thread/resume')
  expect(report?.reverted).toBeNull()
  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
    SECOND_TURN,
  ])
})

function resumedThenReverted() {
  const reverted = ROLLOUT.replace('.jsonl', '_reverted.jsonl')

  return edited('resumed.ndjson', text => {
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
}

it('cuts a Retry’s unloaded thread before the failed turn, from Codex’s longer rollout, and keeps that rollout', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp([resumedThenReverted()], {store: opened.store})

  const rollout = extendSavedRollout(
    opened.store,
    codex.configDir,
    'interrupted',
    'failed'
  )

  const onDisk = fs.readFileSync(rollout)

  const retried = await codex.reply(THIRD_PROMPT, {
    ...recordedIn(second),
    type: 'cut',
    keepThrough: 'interrupted',
    dropFrom: 'failed',
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
  expect(report?.contexts).toEqual([
    [THREAD_ID, FIRST_TURN, SECOND_TURN, 'interrupted'],
  ])
  const {projectKey, sessionId} = folderOf(THREAD_ID)
  const saved = codex.store.filesOf(projectKey, sessionId).get(ROLLOUT)
  expect(
    Buffer.from(saved?.base64 ?? '', 'base64').subarray(0, onDisk.length)
  ).toEqual(onDisk)
})

it('doesn’t cut again when Codex stops after the cut and a new app-server takes the Retry', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp([resumedThenReverted(), 'resumed.ndjson'], {
    store: opened.store,
    exitAt: 'turn/start',
    exits: 1,
  })

  extendSavedRollout(opened.store, codex.configDir, 'interrupted', 'failed')

  const retried = await codex.reply(THIRD_PROMPT, {
    ...recordedIn(second),
    type: 'cut',
    keepThrough: 'interrupted',
    dropFrom: 'failed',
  })

  expect(retried.at(-1)).toMatchObject({status: 'complete'})
  expect(droppedIn(retried)).toBe(true)
  const [cut, fresh] = codex.reports()

  expect(cut?.reverted).toBe('failed')
  expect(fresh?.methods).not.toContain('thread/revert')
})

function resumedThenRevertRefused(turnIds: string[]) {
  return edited('resumed.ndjson', text => {
    const lines = text.split('\n')
    const resumed = lines.findIndex(line => line.includes('"id":2,"result"'))

    return lines
      .toSpliced(
        resumed + 1,
        0,
        ...[
          {
            kind: 'in',
            message: {
              id: 99,
              method: 'thread/revert',
              params: {threadId: THREAD_ID, beforeTurnId: 'failed'},
            },
          },
          {
            kind: 'out',
            message: {
              id: 99,
              error: {code: -32600, message: 'turn not found: failed'},
            },
          },
          {
            kind: 'in',
            message: {
              id: 100,
              method: 'thread/turns/list',
              params: {
                threadId: THREAD_ID,
                cursor: null,
                itemsView: 'notLoaded',
              },
            },
          },
          {
            kind: 'out',
            message: {
              id: 100,
              result: {
                data: turnIds.map(id => ({id})),
                nextCursor: null,
                backwardsCursor: null,
              },
            },
          },
        ].map(step => JSON.stringify(step))
      )
      .join('\n')
  })
}

it('counts a Retry’s cut as made when Codex no longer has the failed turn', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(
    [resumedThenRevertRefused([FIRST_TURN, SECOND_TURN, 'interrupted'])],
    {store: opened.store}
  )

  extendSavedRollout(opened.store, codex.configDir, 'interrupted')

  const retried = await codex.reply(THIRD_PROMPT, {
    ...recordedIn(second),
    type: 'cut',
    keepThrough: 'interrupted',
    dropFrom: 'failed',
  })

  expect(retried.at(-1)).toMatchObject({status: 'complete'})
  expect(droppedIn(retried)).toBe(true)
})

it('fails a Retry whose cut Codex refuses while it still has the failed turn', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  const second = await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(
    [
      resumedThenRevertRefused([
        FIRST_TURN,
        SECOND_TURN,
        'interrupted',
        'failed',
      ]),
    ],
    {store: opened.store}
  )

  extendSavedRollout(opened.store, codex.configDir, 'interrupted', 'failed')

  const retried = await codex.reply(THIRD_PROMPT, {
    ...recordedIn(second),
    type: 'cut',
    keepThrough: 'interrupted',
    dropFrom: 'failed',
  })

  expect(retried.at(-1)).toMatchObject({
    status: 'failed',
    failure: {message: 'turn not found: failed'},
  })
  expect(droppedIn(retried)).toBe(false)
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

const REFUSED = 'Input exceeds the maximum length of 1048576 characters.'

function refusedOverCap(counts: {max_chars: unknown; actual_chars: unknown}) {
  return edited('started.ndjson', text => {
    const lines = text.split('\n')
    const answered = lines.findIndex(line => line.includes('"id":3,"result"'))

    return [
      ...lines.slice(0, answered),
      JSON.stringify({
        kind: 'out',
        message: {
          id: 3,
          error: {
            code: -32_602,
            data: {input_error_code: 'input_too_large', ...counts},
            message: REFUSED,
          },
        },
      }),
      JSON.stringify({kind: 'end'}),
    ].join('\n')
  })
}

it('fails the Reply as too long, with both counts, when Codex refuses a Prompt over its text cap', async () => {
  const codex = await setUp([
    refusedOverCap({max_chars: 1_048_576, actual_chars: 1_048_577}),
  ])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.map(event => event.type)).toEqual([
    'RUN_STARTED',
    'RUN_FINISHED',
  ])
  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {
      code: 'too-long',
      message: REFUSED,
      promptChars: 1_048_577,
      maxPromptChars: 1_048_576,
    },
  })
  await codex.allClosed()
})

it('fails the Reply as too long, without counts, when Codex refuses a Prompt over its text cap with a malformed count', async () => {
  const codex = await setUp([
    refusedOverCap({max_chars: '1048576', actual_chars: 1_048_577}),
  ])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.at(-1)).toEqual(
    expect.objectContaining({
      status: 'failed',
      failure: {code: 'too-long', message: REFUSED},
    })
  )
  await codex.allClosed()
})

it('fails the Reply when a new Codex also stops before answering', async () => {
  const codex = await setUp(['started.ndjson', 'started.ndjson'], {
    exitAt: 'turn/start',
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
    exitAt: 'thread/tokenUsage/updated',
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
        '"status":"failed","error":{"message":"You’ve hit your usage limit.","codexErrorInfo":"usageLimitExceeded"}'
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

it('names a workspace out of credits a reached limit, with no reset time, though a window is full', async () => {
  const limited = edited('started.ndjson', text =>
    text
      .replace('"usedPercent":0', '"usedPercent":100')
      .replace(
        '"rateLimitReachedType":null',
        '"rateLimitReachedType":"workspace_owner_credits_depleted"'
      )
      .replace(
        '"status":"completed","error":null',
        '"status":"failed","error":{"message":"Your workspace is out of credits.","codexErrorInfo":"usageLimitExceeded"}'
      )
  )

  vi.useFakeTimers({toFake: ['Date'], now: new Date('2026-10-23T09:00:00Z')})
  const codex = await setUp([limited])

  const events = await codex.reply(FIRST_PROMPT)

  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'limit-reached'},
  })
  expect(events.at(-1)).not.toHaveProperty('failure.resetsAt')
})

it('names when a limit lifts by a full window a later update leaves out', async () => {
  const limited = edited('started.ndjson', text => {
    const lines = text
      .replace('"usedPercent":0', '"usedPercent":100')
      .replace(
        '"status":"completed","error":null',
        '"status":"failed","error":{"message":"You’ve hit your usage limit.","codexErrorInfo":"usageLimitExceeded"}'
      )
      .split('\n')

    const at = lines.findIndex(line =>
      line.includes('account/rateLimits/updated')
    )

    return lines
      .toSpliced(
        at + 1,
        0,
        JSON.stringify({
          kind: 'out',
          message: {
            method: 'account/rateLimits/updated',
            params: {rateLimits: {primary: null, secondary: null}},
          },
        })
      )
      .join('\n')
  })

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
    exitAt: 'turn/start',
    exits: 1,
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(textOf(events)).toBe('Hi there, friend!')
  expect(events.at(-1)).toMatchObject({status: 'complete'})
  const [stopped, fresh] = codex.reports()

  expect(stopped?.ended).toBe('exited')
  expect(fresh?.prompts).toEqual([FIRST_PROMPT])
})

it('fails the Reply rather than send the Prompt again when Codex stops after accepting it', async () => {
  const codex = await setUp(['started.ndjson', 'started.ndjson'], {
    exitAt: 'turn/started',
    exits: 1,
  })

  const events = await codex.reply(FIRST_PROMPT)

  expect(promptRecordedIn(events)).toEqual({
    sessionId: THREAD_ID,
    messageId: FIRST_TURN,
  })
  expect(events.at(-1)).toMatchObject({
    status: 'failed',
    failure: {code: 'program-crashed'},
  })
  const reports = codex.reports()

  expect(reports).toHaveLength(1)
  expect(reports[0]?.prompts).toEqual([FIRST_PROMPT])
})

function openedAt(threadId: string, rollout: string) {
  return {id: threadId, path: `/codex-home/${rollout}`, forkedFromId: null}
}

function revertTo(threadId: string, rollout: string) {
  return [
    {
      kind: 'in',
      message: {
        id: 98,
        method: 'thread/revert',
        params: {threadId, beforeTurnId: 'recorded'},
      },
    },
    {
      kind: 'out',
      message: {
        id: 98,
        result: {
          thread: openedAt(threadId, rollout),
          turnsBackwardsCursor: null,
          itemsBackwardsCursor: null,
        },
      },
    },
  ]
}

function readOf(threadId: string, rollout: string) {
  return [
    {kind: 'in', message: {id: 99, method: 'thread/read', params: {threadId}}},
    {
      kind: 'out',
      message: {id: 99, result: {thread: openedAt(threadId, rollout)}},
    },
  ]
}

/** Main's switches differ from the empty `config` a cut loads a thread with. */
function reloadOf(threadId: string, rollout: string) {
  return [
    {
      kind: 'in',
      message: {id: 96, method: 'thread/unsubscribe', params: {threadId}},
    },
    {kind: 'out', message: {id: 96, result: {status: 'unsubscribed'}}},
    {
      kind: 'in',
      message: {id: 97, method: 'thread/resume', params: {threadId}},
    },
    {
      kind: 'out',
      message: {
        id: 97,
        result: {thread: openedAt(threadId, rollout), model: MODEL},
      },
    },
  ]
}

function withSteps(
  name: string,
  afterId: number,
  steps: object[],
  {rest}: {rest: boolean}
) {
  return edited(name, text => {
    const lines = text.split('\n').filter(Boolean)

    const at = lines.findIndex(line =>
      line.includes(`"id":${afterId},"result"`)
    )

    return [
      ...lines.slice(0, at + 1),
      ...steps.map(step => JSON.stringify(step)),
      ...(rest ? lines.slice(at + 1) : ['{"kind":"end"}']),
    ].join('\n')
  })
}

const CUT_ROLLOUT = ROLLOUT.replace('.jsonl', '_cut.jsonl')

it('keeps a loaded thread’s cut in the app’s copy, so a resume from it alone lacks the deleted Turns', async () => {
  const opened = await setUp([
    withSteps(
      'started.ndjson',
      6,
      [...revertTo(THREAD_ID, CUT_ROLLOUT), ...readOf(THREAD_ID, CUT_ROLLOUT)],
      {rest: false}
    ),
  ])

  const first = await opened.reply(FIRST_PROMPT)
  await opened.reply(SECOND_PROMPT, recordedIn(first))
  await expect(opened.cut(THREAD_ID, FIRST_TURN, SECOND_TURN)).resolves.toBe(
    true
  )
  await opened.allClosed()

  const codex = await setUp(['resumed.ndjson'], {store: opened.store})
  const next = await codex.reply(THIRD_PROMPT, recordedIn(first))

  expect(next.at(-1)).toMatchObject({status: 'complete'})
  const [report] = codex.reports()

  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THREAD_ID,
    FIRST_TURN,
  ])
  expect(report?.contexts).toEqual([[THREAD_ID, FIRST_TURN]])
})

it('cuts an unloaded thread from a mid-Thread Prompt, dropping every Turn after it, and keeps the cut in the app’s copy', async () => {
  const opened = await setUp(['thanked.ndjson'])
  const hi = await opened.reply(FIRST_PROMPT)
  const bye = await opened.reply(SECOND_PROMPT, recordedIn(hi))
  await opened.reply('Now say thanks in three words.', recordedIn(bye))
  await opened.allClosed()

  const cutter = await setUp(['cut.ndjson'], {store: opened.store})

  await expect(
    cutter.cut(THANKED_THREAD_ID, HELLO_TURN, promptRecordedIn(bye).messageId)
  ).resolves.toBe(true)
  await cutter.allClosed()
  const [cut] = cutter.reports()

  expect(cut?.resumedFrom.map(line => line.id)).toEqual([
    THANKED_THREAD_ID,
    HELLO_TURN,
    GOODBYE_TURN,
    THANKS_TURN,
  ])
  expect(cut?.reverted).toBe(GOODBYE_TURN)
  expect(cut?.ended).toBe('input-closed')

  const codex = await setUp(['cut-resumed.ndjson'], {store: opened.store})

  const next = await codex.reply(
    'What did I ask you to say? Just the words.',
    recordedIn(hi)
  )

  expect(next.at(-1)).toMatchObject({status: 'complete'})
  const [report] = codex.reports()

  expect(report?.resumedFrom.map(line => line.id)).toEqual([
    THANKED_THREAD_ID,
    HELLO_TURN,
  ])
  expect(report?.contexts).toEqual([[THANKED_THREAD_ID, HELLO_TURN]])
})

it('cuts deleted Turns from the loaded thread on the next Prompt, before Codex starts its turn', async () => {
  const codex = await setUp(['reverted.ndjson'])
  const hi = await codex.reply(FIRST_PROMPT)
  await codex.reply(SECOND_PROMPT, recordedIn(hi))

  const next = await codex.reply(
    'What was the last thing I asked you? Just the words.',
    {
      ...recordedIn(hi),
      type: 'cut',
      keepThrough: HI_TURN,
      dropFrom: BYE_TURN,
    }
  )

  expect(droppedIn(next)).toBe(true)
  const [report] = codex.reports()

  expect(report?.contexts.at(-1)).toEqual([REWOUND_THREAD_ID, HI_TURN])
})

it('starts, resumes and forks every thread in the Tree’s folder with full access', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const resumed = await setUp(['resumed.ndjson'], {store: opened.store})
  await resumed.reply(THIRD_PROMPT, recordedIn(first))

  const forked = await setUp(['forked.ndjson'], {store: opened.store})
  await forked.reply(FORK_PROMPT, {...recordedIn(first), type: 'fork'})

  const fullAccess = {sandbox: 'danger-full-access', approvalPolicy: 'never'}

  expect(
    [opened, resumed, forked].map(codex => codex.reports()[0]?.threadAccess)
  ).toEqual([
    [{cwd: opened.treeFolder, ...fullAccess}],
    [{cwd: resumed.treeFolder, ...fullAccess}],
    [{cwd: forked.treeFolder, ...fullAccess}],
  ])
})

it('starts, resumes and forks every thread under Supervised in the Tree’s folder, sandboxed to write there and asking before anything that isn’t trusted', async () => {
  const supervised = {permissionMode: 'supervised'} as const
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT, null, supervised)
  await opened.reply(SECOND_PROMPT, recordedIn(first), supervised)
  await opened.allClosed()

  const resumed = await setUp(['resumed.ndjson'], {store: opened.store})
  await resumed.reply(THIRD_PROMPT, recordedIn(first), supervised)

  const forked = await setUp(['forked.ndjson'], {store: opened.store})

  await forked.reply(
    FORK_PROMPT,
    {...recordedIn(first), type: 'fork'},
    supervised
  )

  const asking = {sandbox: 'workspace-write', approvalPolicy: 'untrusted'}

  expect(
    [opened, resumed, forked].map(codex => codex.reports()[0]?.threadAccess)
  ).toEqual([
    [{cwd: opened.treeFolder, ...asking}],
    [{cwd: resumed.treeFolder, ...asking}],
    [{cwd: forked.treeFolder, ...asking}],
  ])
  expect(opened.reports()[0]?.turnAccess).toEqual(
    [1, 2].map(() => ({
      cwd: opened.treeFolder,
      approvalPolicy: 'untrusted',
      sandboxPolicy: {
        type: 'workspaceWrite',
        writableRoots: [opened.treeFolder],
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
      },
    }))
  )
})

const APPROVALS_THREAD_ID = '01a2150c-452a-7f93-a351-0e1be2fe7630'
const ALLOWED_CHANGE = 'exec-b941c2bd-c584-4f54-9d29-4bd5fadc28fd'
const LISTING = 'exec-1f6c1f4d-14ba-4af9-ba8e-91161d7b6dd5'

function cardsIn(events: Streamed[]) {
  return events.flatMap(event =>
    event.type === 'APPROVAL_REQUESTED' || event.type === 'APPROVAL_RESOLVED'
      ? [event]
      : []
  )
}

/** The Replies of `approvals.ndjson`, in order, up to `count` of them. */
async function approvalReplies(
  codex: Awaited<ReturnType<typeof setUp>>,
  count: number,
  allowedUnder: PermissionMode = 'supervised'
) {
  const supervised = {permissionMode: 'supervised'} as const
  const ready = await codex.reply('Reply with the single word READY.')
  const replies = [ready]

  const steps = [
    async () =>
      codex.reply('allowed', recordedIn(ready), {permissionMode: allowedUnder}),
    async (before: Streamed[]) =>
      codex.reply('denied', recordedIn(before), {
        ...supervised,
        answer: 'deny',
      }),
    async (before: Streamed[]) =>
      codex.reply('stopped', recordedIn(before), {
        ...supervised,
        answer: 'stop',
      }),
    async (before: Streamed[]) =>
      codex.reply('first', recordedIn(before), {
        ...supervised,
        answer: 'always-allow',
      }),
    async (before: Streamed[]) =>
      codex.reply('second', recordedIn(before), supervised),
    async () =>
      codex.reply('third', null, {
        ...supervised,
        inTree: crypto.randomUUID(),
        grants: [{kind: 'edits-in-tree'}],
      }),
  ]

  for (const step of steps.slice(0, count - 1)) {
    replies.push(await step(replies.at(-1) ?? ready))
  }

  return replies
}

it('under Supervised, shows a card for a file write in the Tree’s folder at its tool call, before its result, and lets Codex write it once allowed; a command Codex parsed as a listing runs with no card', async () => {
  const codex = await setUp(['approvals.ndjson'])
  const [, allowed = []] = await approvalReplies(codex, 2)

  const card = allowed.find(event => event.type === 'APPROVAL_REQUESTED')

  expect(cardsIn(allowed)).toEqual([
    {
      treeId: expect.any(String),
      replyId: expect.any(String),
      type: 'APPROVAL_REQUESTED',
      approvalId: expect.any(String),
      toolCallId: ALLOWED_CHANGE,
      action: {
        kind: 'edit',
        // The recording was made on a Mac, so on Windows its path mixes separators.
        paths: [`${codex.treeFolder}/allowed.txt`],
        inTreeFiles: true,
      },
    },
    expect.objectContaining({
      type: 'APPROVAL_RESOLVED',
      approvalId: card?.approvalId,
      answer: 'allow-once',
    }),
  ])
  expect(
    allowed
      .filter(
        event =>
          event.type.startsWith('APPROVAL_') ||
          ('toolCallId' in event && event.toolCallId === ALLOWED_CHANGE)
      )
      .map(event => event.type)
  ).toEqual([
    'TOOL_CALL_START',
    'TOOL_CALL_ARGS',
    'APPROVAL_REQUESTED',
    'APPROVAL_RESOLVED',
    'TOOL_RESULT',
  ])
  expect(shown(allowed).content).toContainEqual(
    expect.objectContaining({toolCallId: LISTING, toolName: 'commandExecution'})
  )
  expect(allowed.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.answers).toEqual([
    {id: 0, result: {decision: 'accept'}},
    {id: 1, result: {decision: 'accept'}},
  ])
})

it('declines a file write the card denies, and the Reply goes on', async () => {
  const codex = await setUp(['approvals.ndjson'])
  const [, , denied = []] = await approvalReplies(codex, 3)

  expect(cardsIn(denied).map(event => event.type)).toEqual([
    'APPROVAL_REQUESTED',
    'APPROVAL_RESOLVED',
  ])
  expect(denied.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.answers.at(-1)).toEqual({
    id: 2,
    result: {decision: 'decline'},
  })
})

it('drops the card of a Reply stopped while it waits, answering Codex nothing', async () => {
  const codex = await setUp(['approvals.ndjson'])
  const replies = await approvalReplies(codex, 4)
  const stopped = replies[3] ?? []
  const card = stopped.find(event => event.type === 'APPROVAL_REQUESTED')

  expect(cardsIn(stopped).map(event => event.type)).toEqual([
    'APPROVAL_REQUESTED',
  ])
  expect(stopped.at(-1)).toMatchObject({status: 'stopped'})

  // An answer after the Reply moved on reaches no one.
  if (card) await codex.driver.answerApproval(card.approvalId, 'allow-once')

  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  await codex.allClosed()
  const [report] = codex.reports()

  expect(report?.answers.map(answer => answer.id)).toEqual([0, 1, 2])
  expect(report?.interrupted).toBe(promptRecordedIn(stopped).messageId)
})

it('shows no card in a Tree once a write there was always allowed, nor in another Tree whose request carries the grant, and accepts both writes', async () => {
  const codex = await setUp(['approvals.ndjson'])
  const replies = await approvalReplies(codex, 7)
  const [first = [], second = [], third = []] = replies.slice(4)

  expect(cardsIn(first).at(-1)).toMatchObject({answer: 'always-allow'})
  expect(cardsIn(second)).toEqual([])
  expect(cardsIn(third)).toEqual([])
  expect(recordedIn(third).sessionId).not.toBe(APPROVALS_THREAD_ID)
  expect(codex.reports()[0]?.answers.slice(-3)).toEqual([
    {id: 4, result: {decision: 'accept'}},
    {id: 5, result: {decision: 'accept'}},
    {id: 6, result: {decision: 'accept'}},
  ])
})

/** `approvals.ndjson` with its `ls` run as `command`, not parsed as a read. */
function unparsedListing(command: string) {
  return edited('approvals.ndjson', text =>
    text
      .replaceAll(
        '{"type":"listFiles","command":"ls","path":null}',
        '{"type":"unknown","command":"ls"}'
      )
      .replaceAll('"/bin/zsh -lc ls"', JSON.stringify(command))
  )
}

it.each([
  ['/bin/zsh -lc ls', 'ls'],
  [String.raw`/bin/bash -c 'cat notes.txt'\''s'`, "cat notes.txt's"],
  ['/bin/sh -c "echo \\"hi\\""', 'echo "hi"'],
  ['/bin/zsh -lc "echo $HOME"', '/bin/zsh -lc "echo $HOME"'],
  ['ls -la', 'ls -la'],
])(
  'shows the card of the command %j as %j, without the shell it runs in unless it’s some other shape',
  async (command, onCard) => {
    const codex = await setUp([unparsedListing(command)])
    const [, allowed = []] = await approvalReplies(codex, 2)

    expect(
      cardsIn(allowed).flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event.action] : []
      )
    ).toEqual([
      expect.objectContaining({kind: 'edit'}),
      {kind: 'command', command: onCard},
    ])
  }
)

it('declines a command request that names no command, with no card', async () => {
  const codex = await setUp([
    edited('approvals.ndjson', text =>
      text
        .replaceAll(
          '{"type":"listFiles","command":"ls","path":null}',
          '{"type":"unknown","command":"ls"}'
        )
        .replace(
          '"environmentId":"local","command":"/bin/zsh -lc ls",',
          '"environmentId":"local","command":null,'
        )
    ),
  ])

  const [, allowed = []] = await approvalReplies(codex, 2)

  expect(
    cardsIn(allowed).flatMap(event =>
      event.type === 'APPROVAL_REQUESTED' ? [event.action.kind] : []
    )
  ).toEqual(['edit'])
  expect(codex.reports()[0]?.answers).toEqual([
    {id: 0, result: {decision: 'accept'}},
    {id: 1, result: {decision: 'decline'}},
  ])
})

it('shows no card for a command Claude’s Always allow granted in the Tree, and accepts it', async () => {
  const codex = await setUp([unparsedListing('/bin/zsh -lc ls')])
  const ready = await codex.reply('Reply with the single word READY.')

  const allowed = await codex.reply('allowed', recordedIn(ready), {
    permissionMode: 'supervised',
    // What an Always allow on Claude's Bash `ls` grants.
    grants: [{kind: 'command', command: 'ls'}],
  })

  expect(
    cardsIn(allowed).flatMap(event =>
      event.type === 'APPROVAL_REQUESTED' ? [event.action.kind] : []
    )
  ).toEqual(['edit'])
  expect(codex.reports()[0]?.answers).toEqual([
    {id: 0, result: {decision: 'accept'}},
    {id: 1, result: {decision: 'accept'}},
  ])
})

it('refuses every approval request under full access, with no card', async () => {
  const codex = await setUp(['approvals.ndjson'])
  const [, allowed = []] = await approvalReplies(codex, 2, 'full-access')

  expect(cardsIn(allowed)).toEqual([])
  expect(codex.reports()[0]?.answers).toEqual([
    {id: 0, error: expect.objectContaining({code: -32_601})},
    {id: 1, error: expect.objectContaining({code: -32_601})},
  ])
})

it('starts a Reply in a thread only once a cut of it has finished, in the Tree’s folder with full access', async () => {
  const opened = await setUp(['started.ndjson'])
  const first = await opened.reply(FIRST_PROMPT)
  await opened.reply(SECOND_PROMPT, recordedIn(first))
  await opened.allClosed()

  const codex = await setUp(
    [
      withSteps(
        'resumed.ndjson',
        2,
        [
          ...revertTo(THREAD_ID, CUT_ROLLOUT),
          ...readOf(THREAD_ID, CUT_ROLLOUT),
          ...reloadOf(THREAD_ID, CUT_ROLLOUT),
        ],
        {rest: true}
      ),
    ],
    {store: opened.store}
  )

  const [cut, next] = await Promise.all([
    codex.cut(THREAD_ID, FIRST_TURN, SECOND_TURN),
    codex.reply(THIRD_PROMPT, recordedIn(first)),
  ])

  expect(cut).toBe(true)
  expect(next.at(-1)).toMatchObject({status: 'complete'})
  const [report] = codex.reports()

  expect(report?.contexts).toEqual([[THREAD_ID, FIRST_TURN]])
  expect(report?.threadConfigs).toEqual([{}, DEFAULT_TOOLS_OFF])
  // The turn undoes the cut's read-only load in the config folder.
  expect(report?.turnAccess).toEqual([
    {
      cwd: codex.treeFolder,
      sandboxPolicy: {type: 'dangerFullAccess'},
      approvalPolicy: 'never',
    },
  ])
})

it('fails a cut when Codex can’t start', async () => {
  const codex = await setUp([])

  await expect(
    codex.driver.cutSession({
      session: {
        type: 'cut',
        sessionId: THREAD_ID,
        messageId: FIRST_TURN,
        keepThrough: FIRST_TURN,
        dropFrom: SECOND_TURN,
      },
      vendorProgram: {program: null, configDir: codex.configDir},
    })
  ).rejects.toThrow('The manifest names no Codex program.')
})

it('opens a thread on the Prompt’s Model, switches it to the Model each later Prompt asks for, and records each Reply on it', async () => {
  const codex = await setUp(['started.ndjson'])

  const first = await codex.reply(FIRST_PROMPT)

  const second = await codex.reply(SECOND_PROMPT, recordedIn(first), {
    model: 'gpt-6-luna',
  })

  expect(first).toContainEqual(
    expect.objectContaining({type: 'REPLY_RECORDED', model: MODEL})
  )
  expect(second).toContainEqual(
    expect.objectContaining({type: 'REPLY_RECORDED', model: 'gpt-6-luna'})
  )
  const [report] = codex.reports()

  expect(report?.threadModels).toEqual([MODEL])
  expect(report?.turnModels).toEqual([MODEL, 'gpt-6-luna'])
})

it('runs the next Prompt on the Model it asks for after a turn failed on a Model that doesn’t exist', async () => {
  const failedFirst = edited('started.ndjson', text =>
    text
      .replace(
        '"status":"completed","error":null',
        '"status":"failed","error":{"message":"The \'gpt-nonexistent-201\' model is not supported when using Codex with a ChatGPT account."}'
      )
      .split('\n')
      .filter(line => !line.includes('"id":4,'))
      .join('\n')
  )

  const codex = await setUp([failedFirst])

  const failed = await codex.reply(FIRST_PROMPT, null, {
    model: 'gpt-nonexistent-201',
  })

  const next = await codex.reply(SECOND_PROMPT, promptRecordedIn(failed))

  expect(failed.at(-1)).toMatchObject({status: 'failed'})
  expect(next).toContainEqual(
    expect.objectContaining({type: 'REPLY_RECORDED', model: MODEL})
  )
  expect(codex.reports()[0]?.turnModels).toEqual(['gpt-nonexistent-201', MODEL])
})

function modelEntry(slug: string, displayName: string, isDefault = false) {
  return {
    id: slug,
    model: slug,
    upgrade: null,
    displayName,
    description: '',
    hidden: false,
    isDefault,
  }
}

function modelListSteps(firstId: number) {
  return [
    {kind: 'in', message: {id: firstId, method: 'model/list', params: {}}},
    {
      kind: 'out',
      message: {
        id: firstId,
        result: {
          data: [
            modelEntry('gpt-6.1-sol', 'GPT-6.1-Sol', true),
            modelEntry('gpt-6-luna', 'GPT-6-Luna'),
          ],
          nextCursor: 'page-2',
        },
      },
    },
    {kind: 'in', message: {id: firstId + 1, method: 'model/list', params: {}}},
    {
      kind: 'out',
      message: {
        id: firstId + 1,
        result: {data: [modelEntry('gpt-5.5', 'GPT-5.5')], nextCursor: null},
      },
    },
  ]
}

const LISTED = [
  {
    id: 'gpt-6.1-sol',
    name: 'GPT-6.1-Sol',
    isDefault: true,
    resolvesTo: null,
    needsAppUpdate: false,
  },
  {
    id: 'gpt-6-luna',
    name: 'GPT-6-Luna',
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
  },
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
  },
]

it('lists the Models page by page on a new app-server, which closes when idle', async () => {
  const listing = withSteps(
    'started.ndjson',
    1,
    [
      {kind: 'in', message: {method: 'initialized'}},
      ...modelListSteps(2),
      ...modelListSteps(4),
    ],
    {rest: false}
  )

  const codex = await setUp([listing, listing])

  await expect(codex.driver.listModels(codex.vendorProgram)).resolves.toEqual(
    LISTED
  )
  expect(codex.reports()[0]?.modelLists).toEqual([
    {cursor: null},
    {cursor: 'page-2'},
  ])

  await codex.driver.listModels(codex.vendorProgram)

  expect(codex.reports()).toHaveLength(1)

  await codex.allClosed()

  expect(codex.reports()[0]?.ended).toBe('input-closed')
})

it('lists the Models on the app-server a Reply already started', async () => {
  const codex = await setUp([
    withSteps('started.ndjson', 4, modelListSteps(10), {rest: false}),
  ])

  await codex.reply(FIRST_PROMPT)

  await expect(codex.driver.listModels(codex.vendorProgram)).resolves.toEqual(
    LISTED
  )
  expect(codex.reports()).toHaveLength(1)
})

const HANDED_OVER: Thread = [
  {
    prompt: 'Name a color.',
    attachments: [],
    reply: [{type: 'text', text: 'Teal.'}],
    label: '[Reply written by Haiku 5.5]',
  },
  {
    prompt: 'And an animal?',
    attachments: [],
    reply: [
      {
        type: 'tool-call',
        toolCallId: 'toolu_1',
        toolName: 'WebSearch',
        args: '{"query":"animals"}',
        result: {content: 'Otters are animals.', isError: false},
      },
      {type: 'text', text: 'Otter.'},
    ],
    label: '[Reply written by Haiku 5.5]',
  },
  {prompt: 'Still there?', attachments: [], reply: [], label: null},
]

function injecting() {
  return edited('started.ndjson', text => {
    const lines = text.split('\n')

    const started = lines.findIndex(line =>
      line.startsWith('{"kind":"out","message":{"id":2,"result"')
    )

    return [
      ...lines.slice(0, started + 1),
      JSON.stringify({
        kind: 'in',
        message: {id: 90, method: 'thread/inject_items', params: {}},
      }),
      JSON.stringify({kind: 'out', message: {id: 90, result: {}}}),
      ...lines.slice(started + 1),
    ].join('\n')
  })
}

function injectRefused() {
  return edited('started.ndjson', text => {
    const lines = text.split('\n')

    const asked = lines.findIndex(line =>
      line.includes('"method":"thread/start"')
    )

    const answered = lines.findIndex(line =>
      line.startsWith('{"kind":"out","message":{"id":2,"result"')
    )

    return [
      ...lines.slice(0, answered + 1),
      JSON.stringify({
        kind: 'in',
        message: {id: 90, method: 'thread/inject_items', params: {}},
      }),
      JSON.stringify({
        kind: 'out',
        message: {id: 90, error: {code: -32600, message: 'invalid item'}},
      }),
      ...lines.slice(asked),
    ].join('\n')
  })
}

it('takes over a Thread Claude wrote: a new thread holding each Turn as a message, then the Prompt as written', async () => {
  const codex = await setUp([injecting()])

  const events = await codex.reply(FIRST_PROMPT, null, {thread: HANDED_OVER})

  expect(textOf(events)).toBe('Hi there, friend!')
  expect(recordedIn(events)).toEqual({
    sessionId: THREAD_ID,
    messageId: FIRST_TURN,
  })

  const [run] = codex.reports()

  expect(run?.methods).not.toContain('thread/resume')
  expect(run?.prompts).toEqual([FIRST_PROMPT])
  expect(events.filter(event => event.type === 'SESSION_REBUILT')).toHaveLength(
    1
  )
  expect(run?.injected).toEqual([
    {
      type: 'message',
      role: 'user',
      content: [{type: 'input_text', text: 'Name a color.'}],
    },
    {
      type: 'message',
      role: 'assistant',
      content: [
        {type: 'output_text', text: '[Reply written by Haiku 5.5]\n\nTeal.'},
      ],
    },
    {
      type: 'message',
      role: 'user',
      content: [{type: 'input_text', text: 'And an animal?'}],
    },
    {
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'output_text',
          text: '[Reply written by Haiku 5.5]\n\n[Tool call: WebSearch]\n{"query":"animals"}\n[Tool result]\nOtters are animals.\n\nOtter.',
        },
      ],
    },
    {
      type: 'message',
      role: 'user',
      content: [{type: 'input_text', text: 'Still there?'}],
    },
  ])

  await codex.allClosed()
})

it('keeps the line that explains the labels when a rebuilt thread resumes in a new codex', async () => {
  const opened = await setUp([injecting()])
  const first = await opened.reply(FIRST_PROMPT, null, {thread: HANDED_OVER})
  await opened.allClosed()

  const thread: Thread = [
    ...HANDED_OVER,
    {
      prompt: FIRST_PROMPT,
      attachments: [],
      reply: [{type: 'text', text: 'Hi there, friend!'}],
      label: null,
    },
  ]

  const codex = await setUp(['resumed.ndjson'], {store: opened.store})
  const events = await codex.reply(THIRD_PROMPT, recordedIn(first), {thread})

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  const [rebuilt] = opened.reports()
  const [resumed] = codex.reports()

  expect(rebuilt?.threadInstructions).toEqual([
    explainingLabels(SYSTEM_PROMPT, HANDED_OVER),
  ])
  expect(resumed?.methods).toContain('thread/resume')
  expect(resumed?.threadInstructions).toEqual([
    explainingLabels(SYSTEM_PROMPT, thread),
  ])

  await codex.allClosed()
})

it('injects nothing for a Tree’s first Prompt', async () => {
  const codex = await setUp(['started.ndjson'])

  const events = await codex.reply(FIRST_PROMPT)

  expect(codex.reports()[0]?.methods).not.toContain('thread/inject_items')
  expect(events.some(event => event.type === 'SESSION_REBUILT')).toBe(false)

  await codex.allClosed()
})

it('replays the Thread as text in a new thread, before the Prompt, when Codex refuses the items', async () => {
  const codex = await setUp([injectRefused()])

  const events = await codex.reply(FIRST_PROMPT, null, {thread: HANDED_OVER})

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  const [run] = codex.reports()
  const [prompt] = run?.prompts ?? []

  expect(run?.methods.filter(method => method === 'thread/start')).toHaveLength(
    2
  )
  expect(prompt).toContain(
    '<reply>\n[Reply written by Haiku 5.5]\n\nTeal.\n</reply>'
  )
  expect(prompt?.endsWith(`</thread>\n\n${FIRST_PROMPT}`)).toBe(true)

  await codex.allClosed()
})

it('rebuilds a thread the app has no copy of from the Thread', async () => {
  const codex = await setUp([injecting()], {
    keepRunningOnRefusal: true,
  })

  const events = await codex.reply(
    FIRST_PROMPT,
    {sessionId: crypto.randomUUID(), messageId: crypto.randomUUID()},
    {thread: HANDED_OVER}
  )

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(recordedIn(events).sessionId).toBe(THREAD_ID)

  const [run] = codex.reports()

  expect(
    run?.methods.filter(method => method.startsWith('thread/')).slice(0, 3)
  ).toEqual(['thread/resume', 'thread/start', 'thread/inject_items'])
  expect(run?.injected).toHaveLength(5)
  expect(run?.prompts).toEqual([FIRST_PROMPT])
  expect(events.filter(event => event.type === 'SESSION_REBUILT')).toHaveLength(
    1
  )

  await codex.allClosed()
})

it('starts a new thread from the Thread under a changed System prompt, which a resumed thread would ignore', async () => {
  const codex = await setUp([injecting()])

  const events = await codex.reply(
    FIRST_PROMPT,
    {sessionId: THREAD_ID, messageId: FIRST_TURN},
    {thread: HANDED_OVER, systemPromptChanged: true}
  )

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  const [run] = codex.reports()

  expect(run?.methods).not.toContain('thread/resume')
  expect(
    run?.methods.filter(method => method.startsWith('thread/')).slice(0, 2)
  ).toEqual(['thread/start', 'thread/inject_items'])
  expect(run?.threadInstructions).toEqual([
    explainingLabels(SYSTEM_PROMPT, HANDED_OVER),
  ])
  expect(run?.injected).toHaveLength(5)
  expect(events.filter(event => event.type === 'SESSION_REBUILT')).toHaveLength(
    1
  )

  await codex.allClosed()
})

const CHART_URL = `data:image/png;base64,${PNG_BASE64}`
const PHOTO_URL = `data:image/jpeg;base64,${SHRUNK_BASE64}`

it('sends each attachment’s path line before the Prompt’s text, in the order attached, and right after its own line each file main marked inline: a text file under its name and an image, from its inline copy, as a data URL; a PDF goes by its line alone', async () => {
  const codex = await setUp(['started.ndjson'])

  const {notes, chart, report, photo, archive, project} = attachedFiles(
    folder('uz-attachments-')
  )

  const events = await codex.reply(FIRST_PROMPT, null, {
    attachments: [notes, chart, byPathOnly(report), photo, archive, project],
  })

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.inputs).toEqual([
    [
      {
        type: 'text',
        text: [
          `[Attached file "notes.txt" is saved at: ${notes.path}]`,
          '<file name="notes.txt">\nBuy milk.\n</file>',
          `[Attached file "chart.png" is saved at: ${chart.path}]`,
        ].join('\n'),
        text_elements: [],
      },
      {type: 'image', url: CHART_URL},
      {
        type: 'text',
        text: [
          `[Attached file "report.pdf" is saved at: ${report.path}]`,
          `[Attached file "photo.jpg" is saved at: ${photo.path}]`,
        ].join('\n'),
        text_elements: [],
      },
      {type: 'image', url: PHOTO_URL},
      {
        type: 'text',
        text: [
          `[Attached file "archive.zip" is saved at: ${archive.path}]`,
          `[Attached folder "project" is at: ${project.path}]`,
          FIRST_PROMPT,
        ].join('\n'),
        text_elements: [],
      },
    ],
  ])

  await codex.allClosed()
})

it('sends a Prompt of attachments alone, each marked for its path only, as their path lines', async () => {
  const codex = await setUp(['started.ndjson'])
  const {notes, chart} = attachedFiles(folder('uz-attachments-'))

  const events = await codex.reply('', null, {
    attachments: [notes, chart].map(byPathOnly),
  })

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.inputs).toEqual([
    [
      {
        type: 'text',
        text: [
          `[Attached file "notes.txt" is saved at: ${notes.path}]`,
          `[Attached file "chart.png" is saved at: ${chart.path}]`,
        ].join('\n'),
        text_elements: [],
      },
    ],
  ])

  await codex.allClosed()
})

it('fails the Reply, starting no codex, when a PDF arrives marked inline, which Codex takes none of', async () => {
  const codex = await setUp(['started.ndjson'])
  const {report} = attachedFiles(folder('uz-attachments-'))

  const events = await codex.reply(FIRST_PROMPT, null, {attachments: [report]})

  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {message: 'ChatGPT takes no PDF inline: “report.pdf”.'},
  })
  expect(codex.reports()).toEqual([])
})

it('hands a Thread over with each earlier Prompt’s path lines in its own user message, an image as input_image and a text file under its name after their lines, and only the line of a PDF', async () => {
  const {chart, report, notes} = attachedFiles(folder('uz-attachments-'))

  const thread: Thread = [
    {
      prompt: 'Sum these up.',
      attachments: [byPathOnly(report), chart, notes],
      reply: [{type: 'text', text: 'Sales rose.'}],
      label: '[Reply written by Haiku 5.5]',
    },
  ]

  const codex = await setUp([injecting()])
  const events = await codex.reply(FIRST_PROMPT, null, {thread})

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.injected[0]).toEqual({
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: [
          `[Attached file "report.pdf" is saved at: ${report.path}]`,
          `[Attached file "chart.png" is saved at: ${chart.path}]`,
        ].join('\n'),
      },
      {type: 'input_image', image_url: CHART_URL},
      {
        type: 'input_text',
        text: [
          `[Attached file "notes.txt" is saved at: ${notes.path}]`,
          '<file name="notes.txt">\nBuy milk.\n</file>',
          'Sum these up.',
        ].join('\n'),
      },
    ],
  })
  expect(codex.reports()[0]?.inputs).toEqual([
    [{type: 'text', text: FIRST_PROMPT, text_elements: []}],
  ])

  await codex.allClosed()
})

it('rebuilds a thread when earlier files can no longer be read: each gets a line saying so in place of its path, inline or by path only, and an image whose shrunk copy is gone goes by its path only', async () => {
  const {notes, chart, archive, photo} = attachedFiles(
    folder('uz-attachments-')
  )

  fs.rmSync(notes.path)
  fs.rmSync(chart.path)
  fs.rmSync(archive.path)
  fs.rmSync(photo.inline.path)

  const thread: Thread = [
    {
      prompt: 'Sum these up.',
      attachments: [notes, chart, archive, photo],
      reply: [{type: 'text', text: 'Sales rose.'}],
      label: null,
    },
  ]

  const codex = await setUp([injecting()])
  const events = await codex.reply(FIRST_PROMPT, null, {thread})

  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(codex.reports()[0]?.injected[0]).toEqual({
    type: 'message',
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: [
          '[Attached file "notes.txt" can no longer be read]',
          '[Attached file "chart.png" can no longer be read]',
          '[Attached file "archive.zip" can no longer be read]',
          `[Attached file "photo.jpg" is saved at: ${photo.path}]`,
          'Sum these up.',
        ].join('\n'),
      },
    ],
  })

  await codex.allClosed()
})

it('replays an earlier Prompt’s path line and image inside its <prompt> in the text replay when Codex refuses the items, and the Prompt’s own after the Thread', async () => {
  const codex = await setUp([injectRefused()])
  const {chart, notes} = attachedFiles(folder('uz-attachments-'))

  const thread: Thread = [
    {
      prompt: 'What is this?',
      attachments: [chart],
      reply: [{type: 'text', text: 'A chart.'}],
      label: null,
    },
  ]

  const events = await codex.reply(FIRST_PROMPT, null, {
    thread,
    attachments: [notes],
  })

  expect(events.at(-1)).toMatchObject({status: 'complete'})

  const [input] = codex.reports()[0]?.inputs ?? []

  expect(input).toEqual([
    {
      type: 'text',
      text: expect.stringContaining(
        `\n<thread>\n<prompt>\n[Attached file "chart.png" is saved at: ${chart.path}]`
      ),
      text_elements: [],
    },
    {type: 'image', url: CHART_URL},
    {
      type: 'text',
      text: [
        'What is this?',
        '</prompt>',
        '<reply>\nA chart.\n</reply>',
        '</thread>',
        '',
        `[Attached file "notes.txt" is saved at: ${notes.path}]`,
        '<file name="notes.txt">\nBuy milk.\n</file>',
        FIRST_PROMPT,
      ].join('\n'),
      text_elements: [],
    },
  ])

  await codex.allClosed()
})

it('fails the Reply, starting no codex, when a file marked inline can’t be read', async () => {
  const codex = await setUp(['started.ndjson'])
  const {gone} = attachedFiles(folder('uz-attachments-'))

  const events = await codex.reply(FIRST_PROMPT, null, {attachments: [gone]})

  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {
      message: expect.stringMatching(
        /^Couldn’t read the attached file “gone\.txt”/u
      ),
    },
  })
  expect(codex.reports()).toEqual([])
})
