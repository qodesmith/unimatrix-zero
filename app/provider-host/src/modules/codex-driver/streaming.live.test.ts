// With `UZ_RECORD=yes`, each `[records]` test rewrites its files in
// `recordings/`, which the driver tests replay.
import type {SpawnCodex} from './app-server'
import type {RateLimitReachedType} from './protocol/v2/RateLimitReachedType'
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

import {fileHolding, pngShowing} from '#modules/test-attachments/main'
import {markedDeveloperFolder} from '#modules/test-developer-folder/main'
import {heldIdle} from '#modules/test-idle/main'
import {PATH_PROBE, markedPathFolder} from '#modules/test-path-folder/main'
import {listenLocally, startProxy} from '#modules/test-proxy/main'
import {fakeStore} from '#modules/test-store/main'
import {withGitLast} from '#modules/vendor-environment/main'
import {isReplyEvent} from '@uz/contract/host'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {programOf} from '@uz/vendor-program'
import {spawn as spawnProcess, spawnSync} from 'node:child_process'
import {once} from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {buffer} from 'node:stream/consumers'
import {StringDecoder} from 'node:string_decoder'
import zlib from 'node:zlib'
import {afterAll, describe, expect, it} from 'vitest'
import {z} from 'zod'

import {startAppServer} from './app-server'
import {codexArgs, codexEnvironment} from './environment'
import {createCodexDriver, spawnCodex} from './main'
import {portFree} from './port'
import {createRecorder} from './recording'
import {RECORDINGS} from './replay'
import {NOT_ENTITLED, SIGN_IN_PORT} from './sign-in'
import {CONTEXT_COMPACTION} from './wire'

const folder = process.env.UZ_LIVE_CODEX_PROGRAM
const signedIn = process.env.UZ_LIVE_CODEX_HOME

const MODEL = 'gpt-6.1-sol'

const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
  auto: true,
  threshold: null,
}

function homeFrom(source: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
  fs.copyFileSync(path.join(source, 'auth.json'), path.join(home, 'auth.json'))

  return home
}

let sharedTreeFolder: string | null = null

function newTreeFolder() {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-tree-'))
  )
}

function treeFolder() {
  sharedTreeFolder ??= newTreeFolder()

  return sharedTreeFolder
}

afterAll(() => {
  if (sharedTreeFolder)
    fs.rmSync(sharedTreeFolder, {recursive: true, force: true})
})

type Streamed = StartReplyEvent

const TOOLS_PROMPT =
  'Create a file named notes.txt in the current folder holding the single word HERON, with your file editing tool, then run `cat notes.txt` in your shell, and reply with only what it printed.'

const WireLine = z.looseObject({
  id: z.union([z.number(), z.string()]).optional(),
  method: z.string().optional(),
  params: z
    .looseObject({
      itemId: z.string().optional(),
      item: z.looseObject({id: z.string(), type: z.string()}).optional(),
      willRetry: z.boolean().optional(),
    })
    .optional(),
})

const SecondAnswer = z.looseObject({id: z.literal(2), result: z.unknown()})

const ConfigRead = z.looseObject({
  config: z.looseObject({model_verbosity: z.string().nullable()}),
})

const ErrorNotice = z.looseObject({
  willRetry: z.boolean(),
  error: z.looseObject({codexErrorInfo: z.unknown()}),
})

function wireLinesIn(output: Buffer[]) {
  return Buffer.concat(output)
    .toString('utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => WireLine.parse(JSON.parse(line)))
}

function agentMessagesIn(output: Buffer[]) {
  const lines = wireLinesIn(output)

  const streamed = [
    ...new Set(
      lines.flatMap(({method, params}) =>
        method === 'item/agentMessage/delta' && params?.itemId
          ? [params.itemId]
          : []
      )
    ),
  ]

  const finished = lines.flatMap(({method, params}) =>
    method === 'item/completed' && params?.item?.type === 'agentMessage'
      ? [params.item.id]
      : []
  )

  return {streamed, finished}
}

const MANIFEST = path.resolve(
  import.meta.dirname,
  '../../../../main/src/modules/vendor-programs/dev-manifest.json'
)

const PROTOCOL = path.join(import.meta.dirname, 'protocol')

const PinnedManifest = z.looseObject({
  vendorPrograms: z.looseObject({
    codex: z.looseObject({version: z.string()}),
  }),
})

function programIn(pinned: string) {
  return programOf({
    path: pinned,
    build: {
      url: 'https://example.com/codex.tar.gz',
      sha256: '0'.repeat(64),
      size: 1,
      archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
    },
  })
}

/** Starts the app-server as the app starts it and asks it one thing. */
async function askAppServer(
  pinned: string,
  home: string,
  request: {method: string; params: unknown}
) {
  const child = spawnProcess(programIn(pinned), codexArgs(process.platform), {
    cwd: home,
    env: codexEnvironment(process.env, home),
    stdio: ['pipe', 'pipe', 'ignore'],
  })

  const answered = new Promise<unknown>(resolve => {
    createInterface({input: child.stdout}).on('line', line => {
      const message = SecondAnswer.safeParse(JSON.parse(line))

      if (message.success) resolve(message.data.result)
    })
  })

  function send(message: {id?: number; method: string; params?: unknown}) {
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  try {
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: {name: 'uz_live', title: 'UZ live', version: '0'},
        capabilities: null,
      },
    })
    send({method: 'initialized'})
    send({id: 2, ...request})

    return await answered
  } finally {
    child.stdin.end()
    await once(child, 'exit')
  }
}

function filesIn(root: string) {
  return new Map(
    fs
      .readdirSync(root, {recursive: true, encoding: 'utf8'})
      .filter(name => fs.statSync(path.join(root, name)).isFile())
      .map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')])
  )
}

function expectComplete(events: Streamed[]) {
  const last = events.at(-1)

  expect(last?.type === 'RUN_FINISHED' && last.failure).toBeFalsy()
  expect(last).toMatchObject({status: 'complete'})
}

function compactionReplies(program: string, home: string, spawn: SpawnCodex) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawn(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))

      return child
    },
    whenIdle: idle.whenIdle,
  })

  async function reply(
    text: string,
    session: SessionRef | null,
    threshold: CompactionSettings['threshold']
  ) {
    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        treeFolder: treeFolder(),
        session: session && {...session, type: 'continue'},
        thread: [],
        compactionSettings: {auto: true, threshold},
        systemPromptChanged: false,
        tools: DEFAULT_TREE_TOOLS,
        permissionMode: 'full-access',
        hiddenFolders: [],
        treesFolder: '/trees',
        grants: [],
      })
    )

    expectComplete(events)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    if (!recorded) throw new Error('The Reply was not recorded')

    return {
      compacted: events.some(event => event.type === 'CONTEXT_COMPACTED'),
      contextSize:
        events.filter(isReplyEvent).reduce(foldReplyEvent, NEW_REPLY)
          .contextSize ?? 0,
      session: recorded.session,
    }
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  return {reply, closed}
}

const FROM_CLAUDE: Thread = [
  {
    prompt: 'Pick a color for the boat, one word.',
    attachments: [],
    reply: [{type: 'text', text: 'Teal.'}],
    label: '[Reply written by Haiku 5.5]',
  },
  {
    prompt: 'And an animal to paint on it, one word.',
    attachments: [],
    reply: [{type: 'text', text: 'Otter.'}],
    label: '[Reply written by Haiku 5.5]',
  },
]

function threadReplies(program: string, home: string) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const output: Buffer[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawnCodex(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))
      child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

      return child
    },
    whenIdle: idle.whenIdle,
  })

  async function reply(
    text: string,
    session: ReplySession | null,
    thread: Thread,
    attachments: HostAttachment[] = []
  ) {
    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments, messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        treeFolder: treeFolder(),
        session,
        thread,
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        systemPromptChanged: false,
        tools: DEFAULT_TREE_TOOLS,
        permissionMode: 'full-access',
        hiddenFolders: [],
        treesFolder: '/trees',
        grants: [],
      })
    )

    expectComplete(events)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    if (!recorded) throw new Error('The Reply was not recorded')

    const {content} = events
      .filter(isReplyEvent)
      .reduce(foldReplyEvent, NEW_REPLY)

    const shown = content
      .flatMap(part => (part.type === 'text' ? [part.text] : []))
      .join('')

    const calls = content.flatMap(part =>
      part.type === 'tool-call' ? [part] : []
    )

    return {text: shown, calls, session: recorded.session}
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  /** A text replay opens a second thread for a Reply; injected items don't. */
  function threadsStarted() {
    return wireLinesIn(output).filter(line => line.method === 'thread/started')
      .length
  }

  return {reply, closed, threadsStarted}
}

const ServerRequestLine = z.looseObject({
  id: z.union([z.number(), z.string()]),
  method: z.string(),
  params: z.looseObject({
    itemId: z.string().optional(),
    reason: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    commandActions: z
      .array(z.looseObject({type: z.string()}))
      .nullable()
      .optional(),
  }),
})

const ResolvedLine = z.looseObject({
  method: z.literal('serverRequest/resolved'),
  params: z.looseObject({requestId: z.union([z.number(), z.string()])}),
})

function writing(name: string) {
  return `Create a file named ${name} in the current folder holding the single word HERON, with your file editing tool.`
}

interface SandboxFolders {
  treesFolder: string
  hiddenFolders: string[]
}

interface ApprovalReplyOptions {
  treeId: string
  session: SessionRef | ReplySession | null
  permissionMode?: PermissionMode
  grants?: ApprovalGrant[]
  /** How the test answers each card; `stop` stops the Reply instead. */
  answer?: ApprovalAnswer | 'stop'
}

/** Replies on one app-server in `tree`, answering each card as told. */
function approvalReplies(
  program: string,
  home: string,
  tree: string,
  start: SpawnCodex,
  {treesFolder = '/trees', hiddenFolders = []}: Partial<SandboxFolders> = {}
) {
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const output: Buffer[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = start(command, options)
      exits.push(once(child, 'exit').catch(() => undefined))
      child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

      return child
    },
    whenIdle: idle.whenIdle,
  })

  const vendorProgram: SignInRequest = {
    program: {
      path: program,
      build: {
        url: 'https://example.com/codex.tar.gz',
        sha256: '0'.repeat(64),
        size: 1,
        archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
      },
    },
    configDir: home,
  }

  async function reply(
    text: string,
    {
      treeId,
      session,
      permissionMode = 'supervised',
      grants = [],
      answer = 'allow-once',
    }: ApprovalReplyOptions
  ) {
    const replyId = crypto.randomUUID()
    const from = output.length
    const events: Streamed[] = []

    for await (const event of driver.startReply({
      treeId,
      replyId,
      model: MODEL,
      systemPrompt: 'You answer in as few words as you can.',
      prompt: {text, attachments: [], messageId: crypto.randomUUID()},
      vendorProgram,
      treeFolder: tree,
      session: session && {type: 'continue', ...session},
      thread: [],
      compactionSettings: DEFAULT_COMPACTION_SETTINGS,
      systemPromptChanged: false,
      tools: DEFAULT_TREE_TOOLS,
      permissionMode,
      hiddenFolders,
      treesFolder,
      grants,
    })) {
      events.push(event)

      if (event.type !== 'APPROVAL_REQUESTED') continue

      await (answer === 'stop'
        ? driver.stop(replyId)
        : driver.answerApproval(event.approvalId, answer))
    }

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    if (!recorded) throw new Error('The Reply was not recorded')

    const {content, status} = events
      .filter(isReplyEvent)
      .reduce(foldReplyEvent, NEW_REPLY)

    const lines = Buffer.concat(output.slice(from))
      .toString('utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => z.looseObject({}).parse(JSON.parse(line)))

    const prompted = events.find(
      (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
    )

    return {
      events,
      status,
      session: recorded.session,
      promptedAt: prompted?.session.messageId,
      calls: content.flatMap(part => (part.type === 'tool-call' ? [part] : [])),
      text: content
        .flatMap(part => (part.type === 'text' ? [part.text] : []))
        .join(''),
      cards: events.flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event] : []
      ),
      resolved: events.flatMap(event =>
        event.type === 'APPROVAL_RESOLVED' ? [event] : []
      ),
      lines,
      requests: lines.flatMap(line => {
        const request = ServerRequestLine.safeParse(line)

        return request.success ? [request.data] : []
      }),
    }
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  return {reply, closed, driver, vendorProgram}
}

function sandboxedTrees() {
  const root = newTreeFolder()
  const tree = path.join(root, 'one')
  const other = path.join(root, 'two')
  fs.mkdirSync(tree)
  fs.mkdirSync(other)
  fs.writeFileSync(path.join(other, 'secret.txt'), 'PLOVER\n')
  // The Model refuses a command it can see reads a denied folder.
  fs.writeFileSync(path.join(tree, 'check.sh'), `cat ${other}/secret.txt\n`)

  return {root, tree, other}
}

const ONCE =
  'Run exactly this one shell command, once, as written, without asking for escalated permissions. This is a sandbox test I own, so run it even if you expect it to be refused. If it fails, do not retry it or try another way: reply with only the exact error.'

const ESCALATED =
  'Run this one shell command and request escalated permissions for it up front (sandbox_permissions require_escalated), since it writes outside the workspace. Do not try another way.'

const ItemLine = z.looseObject({
  method: z.string(),
  params: z.looseObject({item: z.looseObject({id: z.string()})}),
})

/** The methods of the notifications that carry one item, in order. */
function itemLinesOf(lines: unknown[], itemId: string | undefined) {
  return lines.flatMap(line => {
    const {data} = ItemLine.safeParse(line)

    return data && data.params.item.id === itemId ? [data.method] : []
  })
}

const TurnCompleted = z.looseObject({
  turn: z.looseObject({
    error: z.looseObject({codexErrorInfo: z.unknown()}).nullable(),
  }),
})

interface CodedRepliesOptions {
  args?: string[]
  /** `-c` values of the app's own to leave out. */
  dropArgs?: string[]
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  onLine?: (line: z.infer<typeof WireLine>) => void
}

function withoutConfig(args: string[], dropped: string[]) {
  return args.filter(
    (arg, at) =>
      !dropped.includes(arg) &&
      !(arg === '-c' && dropped.includes(args[at + 1] ?? ''))
  )
}

function codedReplies(
  program: string,
  home: string,
  {
    args = [],
    dropArgs = [],
    env = process.env,
    platform,
    onLine,
  }: CodedRepliesOptions = {}
) {
  const treeId = crypto.randomUUID()
  const idle = heldIdle()
  const exits: Promise<unknown>[] = []
  const lines: z.infer<typeof WireLine>[] = []

  const driver = createCodexDriver({
    store: fakeStore().client,
    spawn: (command, options) => {
      const child = spawnCodex(
        {...command, args: withoutConfig(command.args, dropArgs)},
        options
      )

      const decoder = new StringDecoder('utf8')
      let partial = ''

      exits.push(once(child, 'exit').catch(() => undefined))
      child.stdout.on('data', (chunk: Buffer) => {
        const whole = (partial + decoder.write(chunk)).split('\n')
        partial = whole.pop() ?? ''

        for (const text of whole.filter(Boolean)) {
          const line = WireLine.parse(JSON.parse(text))
          lines.push(line)
          onLine?.(line)
        }
      })

      return child
    },
    commandFor: command => ({command, args}),
    env,
    platform,
    whenIdle: idle.whenIdle,
  })

  async function reply(
    text: string,
    session: SessionRef | null,
    tools: TreeTools = DEFAULT_TREE_TOOLS
  ) {
    const from = lines.length

    const events = await Array.fromAsync(
      driver.startReply({
        treeId,
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: program,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        treeFolder: treeFolder(),
        session: session && {...session, type: 'continue'},
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        systemPromptChanged: false,
        tools,
        permissionMode: 'full-access',
        hiddenFolders: [],
        treesFolder: '/trees',
        grants: [],
      })
    )

    const sent = lines.slice(from)
    const last = events.at(-1)

    const recorded = events.find(
      (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
    )

    return {
      events,
      session: recorded?.session ?? null,
      failure: last?.type === 'RUN_FINISHED' ? last.failure : undefined,
      retried: sent.flatMap(({method, params}) => {
        if (method !== 'error') return []

        const notice = ErrorNotice.parse(params)

        return notice.willRetry ? [notice.error.codexErrorInfo] : []
      }),
      turnErrors: sent.flatMap(({method, params}) =>
        method === 'turn/completed'
          ? [TurnCompleted.parse(params).turn.error?.codexErrorInfo ?? null]
          : []
      ),
    }
  }

  async function closed() {
    idle.pass()
    await Promise.all(exits)
  }

  return {reply, closed}
}

type Answer = (response: http.ServerResponse) => void

function notFound(response: http.ServerResponse) {
  response.writeHead(404).end()
}

async function startStandInApi() {
  let answer: Answer = notFound

  const api = http.createServer((request, response) => {
    if (request.method === 'POST' && request.url?.endsWith('/responses')) {
      answer(response)

      return
    }

    notFound(response)
  })

  // Refusing the WebSocket upgrade makes Codex send its requests over HTTP.
  api.on('upgrade', (_request, socket) =>
    socket.end('HTTP/1.1 426 Upgrade Required\r\n\r\n')
  )

  const url = await listenLocally(api)

  return {
    args: [
      '-c',
      `openai_base_url="${url}/v1"`,
      '-c',
      `chatgpt_base_url="${url}/backend-api/"`,
    ],
    answerWith(next: Answer) {
      answer = next
    },
    close() {
      api.close()
    },
  }
}

function usageLimit(reachedType: RateLimitReachedType, resetAt: number) {
  return (response: http.ServerResponse) => {
    const now = Math.floor(Date.now() / 1000)

    response.writeHead(429, {
      'content-type': 'application/json',
      'x-codex-primary-used-percent': '100',
      'x-codex-primary-window-minutes': '300',
      'x-codex-primary-reset-at': String(resetAt),
      'x-codex-secondary-used-percent': '40',
      'x-codex-secondary-window-minutes': '10080',
      'x-codex-secondary-reset-at': String(now + 3 * 24 * 3600),
      'x-codex-rate-limit-reached-type': reachedType,
    })
    response.end(
      JSON.stringify({
        error: {
          type: 'usage_limit_reached',
          message: 'The usage limit has been reached',
          plan_type: 'plus',
          resets_at: resetAt,
          resets_in_seconds: resetAt - now,
        },
      })
    )
  }
}

function streamFailed(code: string, message: string) {
  return (response: http.ServerResponse) => {
    const failed = {
      type: 'response.failed',
      response: {id: 'resp_stand_in', error: {code, message}},
    }

    response.writeHead(200, {'content-type': 'text/event-stream'})
    response.end(`event: response.failed\ndata: ${JSON.stringify(failed)}\n\n`)
  }
}

const NO_RESPONSE = {responseStreamDisconnected: {httpStatusCode: null}}

function expectRetriedWithNoResponse(retried: unknown[]) {
  expect(retried.length).toBeGreaterThan(0)
  expect(retried).toEqual(retried.map(() => NO_RESPONSE))
}

const ModelsCache = z.looseObject({
  etag: z.string().optional(),
  models: z.array(z.unknown()),
})

const ResponsesBody = z.looseObject({
  input: z.array(z.looseObject({type: z.string()})),
})

type ResponsesBody = z.infer<typeof ResponsesBody>

function decoded(request: http.IncomingMessage, body: Buffer) {
  return request.headers['content-encoding'] === 'zstd'
    ? zlib.zstdDecompressSync(body)
    : body
}

function answeredOk(response: http.ServerResponse, count: number) {
  const id = `resp_stand_in_${count}`

  const events = [
    {type: 'response.created', response: {id}},
    {
      type: 'response.output_item.done',
      item: {
        type: 'message',
        role: 'assistant',
        id: `msg_stand_in_${count}`,
        content: [{type: 'output_text', text: 'ok'}],
      },
    },
    {
      type: 'response.completed',
      response: {
        id,
        usage: {
          input_tokens: 0,
          input_tokens_details: null,
          output_tokens: 0,
          output_tokens_details: null,
          total_tokens: 0,
        },
      },
    },
  ]

  response.writeHead(200, {'content-type': 'text/event-stream'})
  response.end(
    events
      .map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
      .join('')
  )
}

/**
 * Answers every Model request with `ok` and keeps its body. Codex learns the
 * Model's tools from `/models`, so it gets the signed-in home's cached list.
 */
async function startRecordingApi(source: string) {
  const {etag = 'stand-in', models} = ModelsCache.parse(
    JSON.parse(fs.readFileSync(path.join(source, 'models_cache.json'), 'utf8'))
  )

  const bodies: ResponsesBody[] = []

  async function handle(
    request: http.IncomingMessage,
    response: http.ServerResponse
  ) {
    const body = decoded(request, await buffer(request))

    if (request.method === 'POST' && request.url?.endsWith('/responses')) {
      bodies.push(ResponsesBody.parse(JSON.parse(body.toString('utf8'))))
      answeredOk(response, bodies.length)

      return
    }

    if (request.method === 'GET' && request.url?.includes('/models')) {
      response.writeHead(200, {'content-type': 'application/json', etag})
      response.end(JSON.stringify({models}))

      return
    }

    notFound(response)
  }

  const api = http.createServer((request, response) => {
    void handle(request, response)
  })

  api.on('upgrade', (_request, socket) =>
    socket.end('HTTP/1.1 426 Upgrade Required\r\n\r\n')
  )

  const url = await listenLocally(api)

  return {
    args: [
      '-c',
      `openai_base_url="${url}/v1"`,
      '-c',
      `chatgpt_base_url="${url}/backend-api/"`,
    ],
    bodies,
    close() {
      api.close()
    },
  }
}

const BUNDLED_SKILL = 'skill-creator'

function offersSubagents(body: ResponsesBody) {
  return JSON.stringify(body).includes('spawn_agent')
}

/** Codex offers web search inside its `exec` tool, as `web__run`. */
function offersWebSearch(body: ResponsesBody) {
  return JSON.stringify(
    body.input.filter(item => item.type === 'additional_tools')
  ).includes('web__run')
}

/** Codex lists the Skills again in a turn whose list changed. */
function skillListings(items: ResponsesBody['input']) {
  return items
    .map(item => JSON.stringify(item))
    .filter(text => text.includes('<skills_instructions>'))
}

describe.skipIf(!folder || !signedIn)('a live ChatGPT', () => {
  it('[records] [dep:codex-rollout-files] streams, continues the loaded thread, appending to one rollout under sessions/, resumes from the app’s copy alone, then forks mid-Thread', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['started.ndjson', 'resumed.ndjson', 'forked.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    function savedRollouts(session: SessionRef) {
      return [...store.filesOf('codex', session.sessionId).values()]
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null,
      fork = false
    ) {
      const events = await Array.fromAsync(
        on.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          treeFolder: treeFolder(),
          session: session && {...session, type: fork ? 'fork' : 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, recorded}
    }

    try {
      const first = driver()
      const [home, otherHome, thirdHome] = homes as [string, string, string]
      const opened = await reply(first, home, 'Say hi in three words.', null)

      expect(opened.events.some(event => event.type === 'TEXT_DELTA')).toBe(
        true
      )

      const [rollout, ...others] = savedRollouts(opened.recorded.session)

      expect(others).toEqual([])
      expect(rollout?.path).toMatch(/^sessions\/.+\/rollout-[^/]+\.jsonl$/)

      const continued = await reply(
        first,
        home,
        'Now say bye in three words.',
        opened.recorded.session
      )

      expect(continued.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

      const [appended] = savedRollouts(continued.recorded.session)
      const before = Buffer.from(rollout?.base64 ?? '', 'base64')
      const after = Buffer.from(appended?.base64 ?? '', 'base64')

      expect(appended?.path).toBe(rollout?.path)
      expect(after.length).toBeGreaterThan(before.length)
      expect(after.subarray(0, before.length).equals(before)).toBe(true)

      await closed()

      const resumed = await reply(
        driver(),
        otherHome,
        'What was the first thing I asked you?',
        continued.recorded.session
      )

      expect(resumed.recorded.session.sessionId).toBe(
        opened.recorded.session.sessionId
      )

      await closed()

      const forked = await reply(
        driver(),
        thirdHome,
        'What was the last thing I asked you?',
        opened.recorded.session,
        true
      )

      expect(forked.recorded.session.sessionId).not.toBe(
        opened.recorded.session.sessionId
      )

      const answer = forked.events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      expect(answer).toMatch(/hi/i)
      expect(answer).not.toMatch(/bye/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[records] [dep:codex-thread-revert] stops a Reply mid-stream and continues after it, then rewinds the loaded thread for a Retry', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['stopped.ndjson', 'reverted.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null,
      {rewind = false, stopAfter = Infinity} = {}
    ) {
      const replyId = crypto.randomUUID()
      const events: Streamed[] = []
      let deltas = 0

      for await (const event of on.startReply({
        treeId,
        replyId,
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {text, attachments: [], messageId: crypto.randomUUID()},
        vendorProgram: {
          program: {
            path: folder ?? '',
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        treeFolder: treeFolder(),
        session: session && {
          ...session,
          type: rewind ? 'rewind' : 'continue',
        },
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        systemPromptChanged: false,
        tools: DEFAULT_TREE_TOOLS,
        permissionMode: 'full-access',
        hiddenFolders: [],
        treesFolder: '/trees',
        grants: [],
      })) {
        events.push(event)

        if (event.type === 'TEXT_DELTA' && ++deltas === stopAfter) {
          await on.stop(replyId)
        }
      }

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {events, recorded, answer}
    }

    try {
      const [home, otherHome] = homes as [string, string]
      const first = driver()

      const stopped = await reply(
        first,
        home,
        'Count from 1 to 300, one number per line.',
        null,
        {stopAfter: 5}
      )

      expect(stopped.events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'stopped',
      })
      expect(stopped.events.at(-2)?.type).toBe('REPLY_RECORDED')
      expect(stopped.answer).not.toMatch(/\b300\b/)

      const continued = await reply(
        first,
        home,
        'What did I ask you to do? Answer in five words.',
        stopped.recorded.session
      )

      expectComplete(continued.events)
      expect(continued.recorded.session.sessionId).toBe(
        stopped.recorded.session.sessionId
      )

      await closed()

      const second = driver()
      const hi = await reply(second, otherHome, 'Say hi in three words.', null)

      expectComplete(hi.events)

      const bye = await reply(
        second,
        otherHome,
        'Now say bye in three words.',
        hi.recorded.session
      )

      expectComplete(bye.events)

      const retried = await reply(
        second,
        otherHome,
        'What was the last thing I asked you? Just the words.',
        hi.recorded.session,
        {rewind: true}
      )

      expectComplete(retried.events)
      expect(retried.recorded.session.sessionId).toBe(
        hi.recorded.session.sessionId
      )
      expect(retried.answer).toMatch(/hi/i)
      expect(retried.answer).not.toMatch(/bye/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[records] [dep:codex-thread-revert] cuts an unloaded thread from a mid-Thread Prompt, dropping every Turn after it, then resumes from the app’s copy alone', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder(
      ['thanked.ndjson', 'cut.ndjson', 'cut-resumed.ndjson'].map(name =>
        path.join(RECORDINGS, name)
      )
    )

    const homes = [homeFrom(signedIn), homeFrom(signedIn), homeFrom(signedIn)]
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = start(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    function vendorProgram(home: string): SignInRequest {
      return {
        program: {
          path: folder ?? '',
          build: {
            url: 'https://example.com/codex.tar.gz',
            sha256: '0'.repeat(64),
            size: 1,
            archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
          },
        },
        configDir: home,
      }
    }

    async function reply(
      on: ReturnType<typeof driver>,
      home: string,
      text: string,
      session: SessionRef | null
    ) {
      const events = await Array.fromAsync(
        on.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: vendorProgram(home),
          treeFolder: treeFolder(),
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const prompted = events.find(
        (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
      )

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!prompted || !recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {prompted, recorded, answer}
    }

    try {
      const [home, cutHome, thirdHome] = homes as [string, string, string]
      const first = driver()
      const hi = await reply(first, home, 'Say hi in three words.', null)

      const bye = await reply(
        first,
        home,
        'Now say bye in three words.',
        hi.recorded.session
      )

      await reply(
        first,
        home,
        'Now say thanks in three words.',
        bye.recorded.session
      )

      await closed()

      const kept = hi.recorded.session

      await expect(
        driver().cutSession({
          session: {
            type: 'cut',
            ...kept,
            keepThrough: kept.messageId,
            dropFrom: bye.prompted.session.messageId,
          },
          vendorProgram: vendorProgram(cutHome),
        })
      ).resolves.toBe(true)

      await closed()

      const resumed = await reply(
        driver(),
        thirdHome,
        'What did I ask you to say? Just the words.',
        kept
      )

      expect(resumed.recorded.session.sessionId).toBe(kept.sessionId)
      expect(resumed.answer).toMatch(/hi/i)
      expect(resumed.answer).not.toMatch(/bye|thank/i)

      await closed()
    } finally {
      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-history-databases] forgets a failed Prompt once the next is sent from the Reply above it, for two failures in one thread, the second from a rollout written over the one Codex’s databases saw', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const treeId = crypto.randomUUID()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    async function startReply(
      text: string,
      model: string,
      session: ReplySession | null
    ) {
      return Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          treeFolder: treeFolder(),
          session,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )
    }

    async function reply(text: string, session: ReplySession | null) {
      const events = await startReply(text, MODEL, session)

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      const answer = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {recorded, answer}
    }

    async function failed(text: string, above: SessionRef) {
      const events = await startReply(text, 'gpt-made-up-0', {
        ...above,
        type: 'continue',
      })

      expect(events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: expect.anything(),
      })
    }

    const recall =
      'Quote every message I sent you before this one, word for word.'

    try {
      const first = await reply('Reply with the single word TEAL.', null)

      await failed(
        'Remember the codeword ZANZIBAR and reply with it.',
        first.recorded.session
      )

      const second = await reply(recall, {
        ...first.recorded.session,
        type: 'rewind',
      })

      expect(second.recorded.session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(second.answer).toMatch(/TEAL/)
      expect(second.answer).not.toMatch(/ZANZIBAR/i)

      await failed(
        'Remember the codeword MARMALADE and reply with it.',
        second.recorded.session
      )

      idle.pass()
      await Promise.all(exits)

      expect(
        fs
          .readdirSync(home, {recursive: true, encoding: 'utf8'})
          .some(file => file.endsWith('.sqlite'))
      ).toBe(true)

      const third = await reply(recall, {
        ...second.recorded.session,
        type: 'rewind',
      })

      expect(third.recorded.session.sessionId).toBe(
        first.recorded.session.sessionId
      )
      expect(third.answer).toMatch(/TEAL/)
      expect(third.answer).not.toMatch(/ZANZIBAR|MARMALADE/i)

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[records] [dep:codex-reconnect-new-message] [dep:codex-retry-notice] says it is reconnecting while its connections are refused mid-Reply, then shows only the message Codex starts over, as a new item that leaves the first unfinished, once they are back', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([
      path.join(RECORDINGS, 'reconnected.ndjson'),
    ])

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    const output: Buffer[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))
        child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

        return child
      },
      env: {...process.env, HTTPS_PROXY: proxy.url},
      whenIdle: idle.whenIdle,
    })

    const events: Streamed[] = []
    let deltas = 0

    try {
      for await (const event of driver.startReply({
        treeId: crypto.randomUUID(),
        replyId: crypto.randomUUID(),
        model: MODEL,
        systemPrompt: 'You answer in as few words as you can.',
        prompt: {
          text: 'Make up a three-word ship name, put it on the first line, then write the numbers 1 to 50, one per line.',
          attachments: [],
          messageId: crypto.randomUUID(),
        },
        vendorProgram: {
          program: {
            path: folder,
            build: {
              url: 'https://example.com/codex.tar.gz',
              sha256: '0'.repeat(64),
              size: 1,
              archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
            },
          },
          configDir: home,
        },
        treeFolder: treeFolder(),
        session: null,
        thread: [],
        compactionSettings: DEFAULT_COMPACTION_SETTINGS,
        systemPromptChanged: false,
        tools: DEFAULT_TREE_TOOLS,
        permissionMode: 'full-access',
        hiddenFolders: [],
        treesFolder: '/trees',
        grants: [],
      })) {
        events.push(event)

        if (event.type === 'TEXT_DELTA' && ++deltas === 12) {
          proxy.refuseFor(20_000)
        }
      }

      expectComplete(events)
      expect(
        wireLinesIn(output).filter(
          ({method, params}) => method === 'error' && params?.willRetry
        ).length
      ).toBeGreaterThan(0)
      expect(events.some(event => event.type === 'RECONNECTING')).toBe(true)

      const lines = events
        .filter(isReplyEvent)
        .reduce(foldReplyEvent, NEW_REPLY)
        .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
        .join('')
        .split('\n')

      expect(events.some(event => event.type === 'TEXT_REPLACE')).toBe(true)
      expect(lines.filter(line => !/^\d+$/.test(line))).toHaveLength(1)
      expect(lines.slice(1)).toEqual(
        Array.from({length: 50}, (_, index) => String(index + 1))
      )

      const {streamed, finished} = agentMessagesIn(output)

      expect(streamed.length).toBeGreaterThanOrEqual(2)
      expect(finished).not.toContain(streamed[0])
      expect(finished).toContain(streamed.at(-1))

      idle.pass()
      await Promise.all(exits)
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 600_000)

  it('[dep:codex-retry-notice] [dep:codex-error-info] says it is busy while the Model’s API throttles it with a retry-after, then fails as limit-reached once Codex stops retrying', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})

    api.answerWith(response => {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '1',
      })
      response.end(
        JSON.stringify({
          error: {type: 'rate_limit_exceeded', message: 'Too many requests'},
        })
      )
    })

    try {
      const throttled = await reply('Say hi.', null)

      expect(throttled.retried).toContainEqual({
        responseStreamDisconnected: {httpStatusCode: 429},
      })
      expect(throttled.events).toContainEqual(
        expect.objectContaining({type: 'RECONNECTING', busy: true})
      )
      expect(throttled.turnErrors).toEqual([
        {responseTooManyFailedAttempts: {httpStatusCode: 429}},
      ])
      expect(throttled.events.at(-1)).toMatchObject({
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: {code: 'limit-reached'},
      })

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails as connection-lost once every stream is reset as it flows', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)

    const {reply, closed} = codedReplies(folder, home, {
      env: {...process.env, HTTPS_PROXY: proxy.url},
    })

    try {
      const first = await reply('Reply with the single word TEAL.', null)

      expectComplete(first.events)
      proxy.resetStreams()

      const dropped = await reply(
        'Reply with the single word OTTER.',
        first.session
      )

      expectRetriedWithNoResponse(dropped.retried)
      expect(dropped.turnErrors).toEqual(['other'])
      expect(dropped.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails as connection-lost when a Compaction’s connections are refused', async () => {
    if (!folder || !signedIn) return

    const proxy = await startProxy()
    const home = homeFrom(signedIn)

    // Codex checks the limit as a turn starts, so the padded turn compacts in the next.
    const {reply, closed} = codedReplies(folder, home, {
      args: ['-c', 'model_auto_compact_token_limit=16000'],
      env: {...process.env, HTTPS_PROXY: proxy.url},
      onLine: ({method, params}) => {
        if (
          method === 'item/started' &&
          params?.item?.type === CONTEXT_COMPACTION
        ) {
          proxy.refuseFor(10 * 60_000)
        }
      },
    })

    const padding = 'The harbor log lists no ships today. '.repeat(1000)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null
      )

      expectComplete(padded.events)

      const refused = await reply(
        'Reply with the single word OTTER.',
        padded.session
      )

      expectRetriedWithNoResponse(refused.retried)
      expect(refused.turnErrors).toEqual([
        {httpConnectionFailed: {httpStatusCode: null}},
      ])
      expect(refused.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      proxy.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-error-info] fails a stand-in API’s usage limit as limit-reached at the snapshot’s reset time, and its workspace out of credits and its spend cap as limit-reached with none', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})
    const resetAt = Math.floor(Date.now() / 1000) + 3600

    try {
      api.answerWith(usageLimit('rate_limit_reached', resetAt))

      const limited = await reply('Say hi.', null)

      api.answerWith(usageLimit('workspace_owner_credits_depleted', resetAt))

      const outOfCredits = await reply('Say hi.', null)

      api.answerWith(usageLimit('workspace_owner_usage_limit_reached', resetAt))

      const spendCapped = await reply('Say hi.', null)

      expect(limited.turnErrors).toEqual(['usageLimitExceeded'])
      expect(limited.failure).toMatchObject({
        code: 'limit-reached',
        resetsAt: new Date(resetAt * 1000).toISOString(),
      })
      expect(outOfCredits.turnErrors).toEqual(['usageLimitExceeded'])
      expect(outOfCredits.failure).toMatchObject({code: 'limit-reached'})
      expect(outOfCredits.failure).not.toHaveProperty('resetsAt')
      expect(spendCapped.turnErrors).toEqual(['usageLimitExceeded'])
      expect(spendCapped.failure).toMatchObject({code: 'limit-reached'})
      expect(spendCapped.failure).not.toHaveProperty('resetsAt')

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-error-info] fails a stand-in API’s streamed rate limit as limit-reached, and its streamed usage_limit_reached as connection-lost', async () => {
    if (!folder || !signedIn) return

    const api = await startStandInApi()
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})

    try {
      api.answerWith(
        streamFailed(
          'rate_limit_exceeded',
          'Rate limit reached. Please try again in 0.2s.'
        )
      )

      const rateLimited = await reply('Say hi.', null)

      api.answerWith(
        streamFailed('usage_limit_reached', 'The usage limit has been reached')
      )

      const usageStreamed = await reply('Say hi.', null)

      expect(rateLimited.turnErrors).toEqual(['rateLimitExceeded'])
      expect(rateLimited.failure).toMatchObject({code: 'limit-reached'})
      expectRetriedWithNoResponse(usageStreamed.retried)
      expect(usageStreamed.turnErrors).toEqual(['other'])
      expect(usageStreamed.failure).toMatchObject({code: 'connection-lost'})

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-tool-switches] offers the Model web search and the built-in Skills in a thread started with them on, and neither in a Reply on the same loaded thread once both switches are off, while the Skills listed before stay in its history, and web search again once its switch is back on', async () => {
    if (!folder || !signedIn) return

    const api = await startRecordingApi(signedIn)
    const home = homeFrom(signedIn)
    const {reply, closed} = codedReplies(folder, home, {args: api.args})

    try {
      const on = await reply('Say hi.', null, {
        ...DEFAULT_TREE_TOOLS,
        webSearch: true,
        chatgptBuiltInSkills: true,
      })

      const first = api.bodies.at(-1)

      const off = await reply('Say hi again.', on.session, {
        ...DEFAULT_TREE_TOOLS,
        webSearch: false,
        chatgptBuiltInSkills: false,
      })

      const second = api.bodies.at(-1)

      const back = await reply('Say hi once more.', off.session, {
        ...DEFAULT_TREE_TOOLS,
        webSearch: true,
        chatgptBuiltInSkills: false,
      })

      const third = api.bodies.at(-1)

      if (!first || !second || !third || first === second || second === third) {
        throw new Error('A Reply sent the Model nothing')
      }

      const history = second.input.slice(0, first.input.length)
      const added = second.input.slice(first.input.length)

      expectComplete(on.events)
      expectComplete(off.events)
      expectComplete(back.events)
      expect(off.session?.sessionId).toBe(on.session?.sessionId)
      expect(back.session?.sessionId).toBe(on.session?.sessionId)
      expect(offersWebSearch(first)).toBe(true)
      expect(skillListings(first.input)).toEqual([
        expect.stringContaining(BUNDLED_SKILL),
      ])
      expect(offersWebSearch(second)).toBe(false)
      expect(skillListings(added)).toEqual([
        expect.not.stringContaining(BUNDLED_SKILL),
      ])
      expect(skillListings(history)).toEqual([
        expect.stringContaining(BUNDLED_SKILL),
      ])
      expect(offersWebSearch(third)).toBe(true)

      await closed()
    } finally {
      api.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[records] reports a compaction Codex makes on its own inside a turn, with the thread it compacted', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const treeId = crypto.randomUUID()
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([path.join(RECORDINGS, 'compacted.ndjson')])

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const start = recording ? recorder.spawn : spawnCodex

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      // Codex checks the limit as a turn starts, so the padded turn compacts in the next.
      commandFor: program => ({
        command: program,
        args: ['-c', 'model_auto_compact_token_limit=16000'],
      }),
      whenIdle: idle.whenIdle,
    })

    async function reply(text: string, session: SessionRef | null) {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          treeFolder: treeFolder(),
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, session: recorded.session}
    }

    const padding = 'The harbor log lists no ships today. '.repeat(1000)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null
      )

      const next = await reply(
        'Reply with the single word OTTER.',
        padded.session
      )

      expect(
        padded.events.filter(event => event.type === 'CONTEXT_COMPACTED')
      ).toEqual([])
      expect(
        next.events.filter(event => event.type === 'CONTEXT_COMPACTED')
      ).toEqual([
        expect.objectContaining({
          sessionId: padded.session.sessionId,
          boundaryId: null,
        }),
      ])

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[records] [dep:codex-compaction-limit] compacts a thread past the threshold set, from the next Reply on a thread already loaded', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const recording = process.env.UZ_RECORD === 'yes'

    const recorder = createRecorder([
      path.join(RECORDINGS, 'compaction-settings.ndjson'),
    ])

    const {reply, closed} = compactionReplies(
      folder,
      home,
      recording ? recorder.spawn : spawnCodex
    )

    const padding = 'The harbor log lists no ships today. '.repeat(1200)

    try {
      // Codex checks the limit as a turn starts, so the padded turn can't compact.
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null,
        30_000
      )

      const under = await reply(
        'Reply with the single word OTTER.',
        padded.session,
        30_000
      )

      const lowered = await reply(
        'Reply with the single word HERON.',
        under.session,
        20_000
      )

      expect(under.contextSize).toBeGreaterThan(20_000)
      expect(under.contextSize).toBeLessThan(30_000)
      expect([padded.compacted, under.compacted, lowered.compacted]).toEqual([
        false,
        false,
        true,
      ])

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-compaction-limit] drops a lowered limit from the next Reply on a thread already loaded, once the threshold goes back to the default', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const {reply, closed} = compactionReplies(folder, home, spawnCodex)
    const padding = 'The harbor log lists no ships today. '.repeat(1000)

    try {
      const padded = await reply(
        `Reply with the single word TEAL. Ignore the rest of this message. ${padding}`,
        null,
        20_000
      )

      const restored = await reply(
        'Reply with the single word OTTER.',
        padded.session,
        null
      )

      expect(padded.contextSize).toBeGreaterThan(20_000)
      expect([padded.compacted, restored.compacted]).toEqual([false, false])

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-instructions-on-resume] follows a changed System prompt from the next Reply, on a thread still loaded and on one resumed from the app’s copy alone, and a thread resumed under new instructions keeps its old ones', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const homes = [homeFrom(signedIn), homeFrom(signedIn), homeFrom(signedIn)]
    const [home, otherHome, thirdHome] = homes as [string, string, string]
    const treeId = crypto.randomUUID()
    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = spawnCodex(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function closed() {
      idle.pass()
      await Promise.all(exits)
    }

    async function reply(
      on: ReturnType<typeof driver>,
      {
        home: configDir,
        word,
        text,
        session,
        changed = session !== null,
      }: {
        home: string
        word: string
        text: string
        session: SessionRef | null
        changed?: boolean
      }
    ) {
      const events = await Array.fromAsync(
        on.startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: `Answer every message with only the word ${word}, in capitals, and nothing else.`,
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir,
          },
          treeFolder: treeFolder(),
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: changed,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      const shown = events
        .flatMap(event => (event.type === 'TEXT_DELTA' ? [event.delta] : []))
        .join('')

      return {text: shown, session: recorded.session}
    }

    try {
      const first = driver()

      const opened = await reply(first, {
        home,
        word: 'PINEAPPLE',
        text: 'What is the capital of France?',
        session: null,
      })

      const loaded = await reply(first, {
        home,
        word: 'BANANA',
        text: 'What is 2 + 2?',
        session: opened.session,
      })

      await closed()

      const resumed = await reply(driver(), {
        home: otherHome,
        word: 'CHERRY',
        text: 'Name a color.',
        session: loaded.session,
      })

      await closed()

      const kept = await reply(driver(), {
        home: thirdHome,
        word: 'MANGO',
        text: 'Name an animal.',
        session: resumed.session,
        changed: false,
      })

      await closed()

      expect([opened.text, loaded.text, resumed.text, kept.text]).toEqual([
        expect.stringMatching(/^\W*PINEAPPLE\W*$/),
        expect.stringMatching(/^\W*BANANA\W*$/),
        expect.stringMatching(/^\W*CHERRY\W*$/),
        expect.stringMatching(/^\W*CHERRY\W*$/),
      ])
    } finally {
      for (const each of homes) fs.rmSync(each, {recursive: true, force: true})
    }
  }, 300_000)

  it.runIf(process.platform === 'darwin')(
    '[dep:developer-dir-reaches-commands] runs the xcrun of the developer folder in the host’s environment for a stub in /usr/bin that a command names',
    async () => {
      if (!folder || !signedIn) return

      const home = homeFrom(signedIn)
      const marker = `uz-xcrun-${crypto.randomUUID()}`
      const developerDir = markedDeveloperFolder(marker)

      const {reply, closed} = codedReplies(folder, home, {
        env: {...process.env, DEVELOPER_DIR: developerDir},
      })

      try {
        const {events} = await reply(
          'Run the command `/usr/bin/git --version`, then reply with exactly what it printed.',
          null
        )

        expectComplete(events)

        const results = events
          .filter(isReplyEvent)
          .reduce(foldReplyEvent, NEW_REPLY)
          .content.flatMap(part =>
            part.type === 'tool-call' ? [part.result?.content.trim()] : []
          )

        expect(results).toContain(`${marker} git --version`)

        await closed()
      } finally {
        fs.rmSync(home, {recursive: true, force: true})
        fs.rmSync(developerDir, {recursive: true, force: true})
      }
    },
    300_000
  )

  // The probe is a shell script, and Windows has no login shell to turn off.
  it.skipIf(process.platform === 'win32')(
    '[dep:codex-no-login-shell] runs a command without a login shell when told to, and finds a program by name in a folder added last to its PATH, where it is still last',
    async () => {
      if (!folder || !signedIn) return

      const home = homeFrom(signedIn)
      const marker = `uz-path-${crypto.randomUUID()}`
      const last = markedPathFolder(marker)

      const {reply, closed} = codedReplies(folder, home, {
        platform: 'linux',
        env: withGitLast(process.env, last),
      })

      // 0 in a login shell, under bash's name for it or zsh's.
      const login =
        'shopt -q login_shell 2>/dev/null || [[ -o login ]] 2>/dev/null; echo "login=$?"'

      try {
        const {events} = await reply(
          `Run the command \`${PATH_PROBE}; ${login}\`, then reply with exactly what it printed.`,
          null
        )

        expectComplete(events)

        const results = events
          .filter(isReplyEvent)
          .reduce(foldReplyEvent, NEW_REPLY)
          .content.flatMap(part =>
            part.type === 'tool-call' ? [part.result?.content.trim()] : []
          )

        expect(results).toContain(`${marker} ${last}\nlogin=1`)

        await closed()
      } finally {
        fs.rmSync(home, {recursive: true, force: true})
        fs.rmSync(last, {recursive: true, force: true})
      }
    },
    300_000
  )

  it('[records] [dep:codex-full-access] [dep:codex-server-requests-refused] writes a file in the Tree’s folder and runs a command there, asking the app nothing, and shows each tool call', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)

    const tree = newTreeFolder()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const output: Buffer[] = []

    const recorder = createRecorder([path.join(RECORDINGS, 'tools.ndjson')])
    const start = process.env.UZ_RECORD === 'yes' ? recorder.spawn : spawnCodex

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = start(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))
        child.stdout.on('data', (chunk: Buffer) => output.push(chunk))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    try {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {
            text: TOOLS_PROMPT,
            attachments: [],
            messageId: crypto.randomUUID(),
          },
          vendorProgram: {
            program: {
              path: folder,
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          treeFolder: tree,
          session: null,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)
      expect(fs.readFileSync(path.join(tree, 'notes.txt'), 'utf8').trim()).toBe(
        'HERON'
      )
      expect(fs.readdirSync(tree)).toEqual(['notes.txt'])

      const calls = events
        .filter(isReplyEvent)
        .reduce(foldReplyEvent, NEW_REPLY)
        .content.flatMap(part => (part.type === 'tool-call' ? [part] : []))

      expect(calls.map(call => call.toolName)).toEqual(
        expect.arrayContaining(['fileChange', 'commandExecution'])
      )
      expect(calls.every(call => call.result?.isError === false)).toBe(true)

      const lines = wireLinesIn(output)

      expect(
        lines.filter(line => line.id !== undefined && line.method !== undefined)
      ).toEqual([])

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-full-access] writes a file in the Tree’s folder in a Reply on a thread a cut loaded and kept loaded', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)

    const tree = newTreeFolder()

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    const vendorProgram: SignInRequest = {
      program: {
        path: folder,
        build: {
          url: 'https://example.com/codex.tar.gz',
          sha256: '0'.repeat(64),
          size: 1,
          archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
        },
      },
      configDir: home,
    }

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    async function reply(text: string, session: SessionRef | null) {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram,
          treeFolder: tree,
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const prompted = events.find(
        (event): event is PromptRecorded => event.type === 'PROMPT_RECORDED'
      )

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!prompted || !recorded) throw new Error('The Reply was not recorded')

      return {prompted, recorded}
    }

    try {
      const hi = await reply('Say hi in three words.', null)

      const bye = await reply(
        'Now say bye in three words.',
        hi.recorded.session
      )

      idle.pass()
      await Promise.all(exits)

      const kept = hi.recorded.session

      await expect(
        driver.cutSession({
          session: {
            type: 'cut',
            ...kept,
            keepThrough: kept.messageId,
            dropFrom: bye.prompted.session.messageId,
          },
          vendorProgram,
        })
      ).resolves.toBe(true)

      await reply(TOOLS_PROMPT, kept)

      expect(fs.readFileSync(path.join(tree, 'notes.txt'), 'utf8').trim()).toBe(
        'HERON'
      )
      expect(fs.readdirSync(tree)).toEqual(['notes.txt'])

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 300_000)

  it('[records] [dep:codex-approval-requests] [dep:codex-full-access] under Supervised, on a thread loaded under full access, asks before a file write in the Tree’s folder at its file change, writes it only once allowed, and goes on after a denied one; asks before `ls` with listFiles alone, wrapped in a shell, which runs with no card; drops a waiting request on a Stop; lets an Always allow or a grant the request carries answer later writes; and asks nothing of the thread back under full access', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const tree = newTreeFolder()

    const recorder = createRecorder(
      [path.join(RECORDINGS, 'approvals.ndjson')],
      {
        treeFolder: tree,
      }
    )

    const start = process.env.UZ_RECORD === 'yes' ? recorder.spawn : spawnCodex
    const live = approvalReplies(folder, home, tree, start)
    const treeId = crypto.randomUUID()

    function inTree(name: string) {
      return {kind: 'edit', paths: [path.join(tree, name)], inTreeFiles: true}
    }

    function written(name: string) {
      return fs.existsSync(path.join(tree, name))
    }

    try {
      const ready = await live.reply('Reply with the single word READY.', {
        treeId,
        session: null,
        permissionMode: 'full-access',
      })

      expect(ready.requests).toEqual([])

      // A thread loaded under full access asks from the next turn.
      const allowed = await live.reply(
        `${writing('allowed.txt')} Then run \`ls\` in your shell, and reply with only what it printed.`,
        {treeId, session: ready.session}
      )

      const change = allowed.calls.find(call => call.toolName === 'fileChange')

      const listing = allowed.calls.find(
        call => call.toolName === 'commandExecution'
      )

      expect(allowed.cards.map(card => card.action)).toEqual([
        inTree('allowed.txt'),
      ])
      expect(allowed.cards[0]?.toolCallId).toBe(change?.toolCallId)
      expect(allowed.resolved.map(event => event.answer)).toEqual([
        'allow-once',
      ])
      expect(written('allowed.txt')).toBe(true)
      expect(listing?.result?.content).toContain('allowed.txt')
      expect(
        allowed.requests.map(request => ({
          method: request.method,
          itemId: request.params.itemId,
          command: request.params.command,
          actions: request.params.commandActions?.map(action => action.type),
        }))
      ).toEqual([
        {
          method: 'item/fileChange/requestApproval',
          itemId: change?.toolCallId,
          command: undefined,
          actions: undefined,
        },
        {
          method: 'item/commandExecution/requestApproval',
          itemId: listing?.toolCallId,
          command: expect.stringMatching(/^\/\S*sh -lc ls$/u),
          actions: ['listFiles'],
        },
      ])

      const denied = await live.reply(
        `${writing('denied.txt')} Reply with only DONE once you have tried.`,
        {treeId, session: allowed.session, answer: 'deny'}
      )

      expect(denied.cards.map(card => card.action)).toEqual([
        inTree('denied.txt'),
      ])
      expect(denied.status).toBe('complete')
      expect(written('denied.txt')).toBe(false)

      const stopped = await live.reply(writing('stopped.txt'), {
        treeId,
        session: denied.session,
        answer: 'stop',
      })

      // Codex drops the request it waits on, and says so once the turn ends.
      const dropped = stopped.lines.flatMap(line => {
        const resolved = ResolvedLine.safeParse(line)

        return resolved.success ? [resolved.data.params.requestId] : []
      })

      expect(stopped.status).toBe('stopped')
      expect(stopped.cards).toHaveLength(1)
      expect(stopped.resolved).toEqual([])
      expect(written('stopped.txt')).toBe(false)
      expect(dropped).toEqual(stopped.requests.map(request => request.id))
      expect(dropped).toHaveLength(1)

      const always = await live.reply(writing('first.txt'), {
        treeId,
        session: stopped.session,
        answer: 'always-allow',
      })

      expect(always.cards.map(card => card.action)).toEqual([
        inTree('first.txt'),
      ])
      expect(written('first.txt')).toBe(true)

      // Codex still asks; the Tree's Always allow answers.
      const again = await live.reply(writing('second.txt'), {
        treeId,
        session: always.session,
      })

      expect(again.cards).toEqual([])
      expect(again.requests.map(request => request.method)).toEqual([
        'item/fileChange/requestApproval',
      ])
      expect(written('second.txt')).toBe(true)

      const granted = await live.reply(writing('third.txt'), {
        treeId: crypto.randomUUID(),
        session: null,
        grants: [{kind: 'edits-in-tree'}],
      })

      expect(granted.cards).toEqual([])
      expect(granted.requests).toHaveLength(1)
      expect(written('third.txt')).toBe(true)

      const last = await live.reply(writing('last.txt'), {
        treeId,
        session: again.session,
        permissionMode: 'full-access',
      })

      expect(last.requests).toEqual([])
      expect(written('last.txt')).toBe(true)

      await live.closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(tree, {recursive: true, force: true})
    }
  }, 600_000)

  it('[records] [dep:codex-sandbox-profile] [dep:codex-refused-command-unfinished] under Supervised, an allowed command writes in the Tree’s folder and a package cache; one that writes outside fails with no second run and no item/completed; the same command the Model asks to run outside the Sandbox asks again with a reason, past an Always allow, and then works in its own Tree but still can’t read another Tree, a hidden folder or the keychains; a connection fails; and a read of another Tree fails', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const trees = sandboxedTrees()
    const name = `uz-sandbox-${crypto.randomUUID()}.txt`
    const cached = path.join(os.homedir(), 'Library', 'Caches', name)
    const outside = path.join('/Library/Caches', name)
    const keychains = path.join(os.homedir(), 'Library', 'Keychains')

    const hidden = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-hidden-'))
    )

    fs.writeFileSync(path.join(hidden, 'secret.txt'), 'GANNET\n')
    fs.writeFileSync(
      path.join(trees.tree, 'peek.sh'),
      [
        'echo WREN > wrote.txt',
        `cat wrote.txt >> ${outside}`,
        `cat ${trees.other}/secret.txt >> ${outside} 2>&1`,
        `cat ${hidden}/secret.txt >> ${outside} 2>&1`,
        `ls ${keychains} >> ${outside} 2>&1`,
        '',
      ].join('\n')
    )
    const leaving = `echo KESTREL > ${outside} && sh peek.sh`

    const folders = {treesFolder: trees.root, hiddenFolders: [hidden]}

    const recorder = createRecorder([path.join(RECORDINGS, 'sandbox.ndjson')], {
      treeFolder: trees.tree,
      ...folders,
    })

    const start = process.env.UZ_RECORD === 'yes' ? recorder.spawn : spawnCodex
    const live = approvalReplies(folder, home, trees.tree, start, folders)

    const treeId = crypto.randomUUID()

    try {
      const inside = await live.reply(
        `${ONCE}\n\necho HERON > notes.txt && echo HERON > ${cached} && cat notes.txt`,
        {treeId, session: null}
      )

      const [ran] = inside.calls

      expect(inside.cards.map(card => card.action)).toEqual([
        {
          kind: 'command',
          command: `echo HERON > notes.txt && echo HERON > ${cached} && cat notes.txt`,
        },
      ])
      expect(ran?.result).toMatchObject({content: 'HERON\n', isError: false})
      expect(fs.readFileSync(cached, 'utf8')).toBe('HERON\n')
      expect(itemLinesOf(inside.lines, ran?.toolCallId)).toEqual([
        'item/started',
        'item/completed',
      ])

      const blocked = await live.reply(`${ONCE}\n\n${leaving}`, {
        treeId,
        session: inside.session,
        answer: 'always-allow',
      })

      const [refused] = blocked.calls

      expect(blocked.cards.map(card => card.action)).toEqual([
        {kind: 'command', command: leaving},
      ])
      expect(blocked.requests.map(request => request.params.reason)).toEqual([
        undefined,
      ])
      expect(blocked.status).toBe('complete')
      expect(fs.existsSync(outside)).toBe(false)
      expect(itemLinesOf(blocked.lines, refused?.toolCallId)).toEqual([
        'item/started',
      ])
      expect(refused?.result?.isError).toBe(true)

      const left = await live.reply(`${ESCALATED}\n\n${leaving}`, {
        treeId,
        session: blocked.session,
        answer: 'always-allow',
      })

      expect(left.cards.map(card => card.action)).toEqual([
        {
          kind: 'command',
          command: leaving,
          outsideSandbox: true,
          credentialsDenied: true,
        },
      ])
      expect(left.requests.map(request => request.params.reason)).toEqual([
        expect.stringMatching(/\S/u),
      ])

      const wrote = fs.readFileSync(outside, 'utf8').split('\n')

      expect(wrote.slice(0, 2)).toEqual(['KESTREL', 'WREN'])
      expect(wrote.slice(2, 5)).toEqual([
        expect.stringMatching(/two\/secret\.txt: Operation not permitted$/u),
        expect.stringMatching(/secret\.txt: Operation not permitted$/u),
        expect.stringMatching(/Keychains: Operation not permitted$/u),
      ])
      expect(fs.readFileSync(path.join(trees.tree, 'wrote.txt'), 'utf8')).toBe(
        'WREN\n'
      )

      const connected = await live.reply(
        `${ONCE}\n\ncurl -sS -m 8 -o /dev/null https://example.com`,
        {treeId, session: left.session}
      )

      expect(connected.cards.map(card => card.action)).toEqual([
        {
          kind: 'command',
          command: 'curl -sS -m 8 -o /dev/null https://example.com',
        },
      ])
      expect(connected.calls[0]?.result).toMatchObject({
        content: expect.stringContaining('Could not resolve host'),
        isError: true,
      })

      const read = await live.reply(`${ONCE}\n\nsh check.sh`, {
        treeId,
        session: connected.session,
      })

      expect(read.cards.map(card => card.action)).toEqual([
        {kind: 'command', command: 'sh check.sh'},
      ])
      expect(read.text).toMatch(/secret\.txt: Operation not permitted/u)
      expect(read.text).not.toContain('PLOVER')

      await live.closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(trees.root, {recursive: true, force: true})
      fs.rmSync(cached, {force: true})
      fs.rmSync(outside, {force: true})
      fs.rmSync(hidden, {recursive: true, force: true})
    }
  }, 600_000)

  it('[dep:codex-sandbox-profile] [dep:codex-full-access] holds a Supervised Reply to the Sandbox on a thread loaded under full access, resumed from the app’s copy, forked, and loaded by a cut, and a Reply back under full access to nothing', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const trees = sandboxedTrees()

    const outside = path.join(
      '/Library/Caches',
      `uz-sandbox-${crypto.randomUUID()}.txt`
    )

    const prompt = `${ONCE}\n\necho KESTREL > ${outside}`

    const live = approvalReplies(folder, home, trees.tree, spawnCodex, {
      treesFolder: trees.root,
    })

    const treeId = crypto.randomUUID()

    async function writesOutside(
      session: ApprovalReplyOptions['session'],
      permissionMode: PermissionMode = 'supervised'
    ) {
      fs.rmSync(outside, {force: true})

      const reply = await live.reply(prompt, {treeId, session, permissionMode})

      expect(reply.status).toBe('complete')
      expect(reply.requests).toHaveLength(
        permissionMode === 'supervised' ? 1 : 0
      )

      return {...reply, wrote: fs.existsSync(outside)}
    }

    try {
      const ready = await live.reply('Reply with the single word READY.', {
        treeId,
        session: null,
        permissionMode: 'full-access',
      })

      const loaded = await writesOutside(ready.session)

      expect(loaded.wrote).toBe(false)

      const unrestricted = await writesOutside(loaded.session, 'full-access')

      expect(unrestricted.wrote).toBe(true)

      await live.closed()
      const resumed = await writesOutside(unrestricted.session)

      expect(resumed.wrote).toBe(false)

      const forked = await writesOutside({...resumed.session, type: 'fork'})

      expect(forked.session.sessionId).not.toBe(resumed.session.sessionId)
      expect(forked.wrote).toBe(false)

      await live.closed()

      if (!resumed.promptedAt) throw new Error('The Prompt was not recorded')

      await expect(
        live.driver.cutSession({
          session: {
            type: 'cut',
            ...unrestricted.session,
            keepThrough: unrestricted.session.messageId,
            dropFrom: resumed.promptedAt,
          },
          vendorProgram: live.vendorProgram,
        })
      ).resolves.toBe(true)

      const cut = await writesOutside(unrestricted.session)

      expect(cut.wrote).toBe(false)

      await live.closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(trees.root, {recursive: true, force: true})
      fs.rmSync(outside, {force: true})
    }
  }, 600_000)

  it('[dep:codex-resume-moved-folder] resumes a thread from the app’s copy alone in a Tree folder other than the one it started in, and works there', async () => {
    if (!folder || !signedIn) return

    const store = fakeStore()
    const homes = [homeFrom(signedIn), homeFrom(signedIn)]

    const trees = [0, 1].map(() => newTreeFolder())

    const idle = heldIdle()
    const exits: Promise<unknown>[] = []
    const treeId = crypto.randomUUID()

    function driver() {
      return createCodexDriver({
        store: store.client,
        spawn: (command, options) => {
          const child = spawnCodex(command, options)
          exits.push(once(child, 'exit').catch(() => undefined))

          return child
        },
        whenIdle: idle.whenIdle,
      })
    }

    async function reply(at: number, text: string, session: SessionRef | null) {
      const events = await Array.fromAsync(
        driver().startReply({
          treeId,
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: 'You answer in as few words as you can.',
          prompt: {text, attachments: [], messageId: crypto.randomUUID()},
          vendorProgram: {
            program: {
              path: folder ?? '',
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: homes[at] ?? '',
          },
          treeFolder: trees[at] ?? '',
          session: session && {...session, type: 'continue'},
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      expectComplete(events)

      const recorded = events.find(
        (event): event is ReplyRecorded => event.type === 'REPLY_RECORDED'
      )

      if (!recorded) throw new Error('The Reply was not recorded')

      return {events, session: recorded.session}
    }

    try {
      const first = await reply(0, 'Remember the codeword ZANZIBAR.', null)
      idle.pass()
      await Promise.all(exits)

      const second = await reply(
        1,
        'Run `pwd` in your shell, then reply with the codeword and what it printed, on one line.',
        first.session
      )

      expect(second.session.sessionId).toBe(first.session.sessionId)

      const text = second.events
        .filter(isReplyEvent)
        .reduce(foldReplyEvent, NEW_REPLY)
        .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
        .join('')

      expect(text).toMatch(/ZANZIBAR/)
      expect(text).toContain(trees[1])

      idle.pass()
      await Promise.all(exits)
    } finally {
      for (const made of [...homes, ...trees]) {
        fs.rmSync(made, {recursive: true, force: true})
      }
    }
  }, 300_000)

  it('[dep:codex-subagents-off] offers the Model no Subagents, which the feature flag alone would leave on', async () => {
    if (!folder || !signedIn) return

    const api = await startRecordingApi(signedIn)
    const homes = [homeFrom(signedIn), homeFrom(signedIn)]

    async function requestUnder(at: number, dropArgs: string[]) {
      const {reply, closed} = codedReplies(folder ?? '', homes[at] ?? '', {
        args: api.args,
        dropArgs,
      })

      expectComplete((await reply('Say hi.', null)).events)
      await closed()

      const body = api.bodies.at(-1)

      if (!body) throw new Error('The Reply sent the Model nothing')

      return body
    }

    try {
      const app = await requestUnder(0, [])
      const flagOnly = await requestUnder(1, ['agents.enabled=false'])

      expect(offersSubagents(app)).toBe(false)
      expect(offersSubagents(flagOnly)).toBe(true)
    } finally {
      api.close()

      for (const home of homes) fs.rmSync(home, {recursive: true, force: true})
    }
  }, 180_000)

  it('[dep:codex-project-config-untrusted] leaves out a setting in a Tree folder’s .codex/config.toml, and takes it once CODEX_HOME trusts the folder', async () => {
    if (!folder || !signedIn) return

    const tree = newTreeFolder()
    fs.mkdirSync(path.join(tree, '.codex'))
    fs.writeFileSync(
      path.join(tree, '.codex', 'config.toml'),
      'model_verbosity = "high"\n'
    )

    const home = homeFrom(signedIn)
    // Without a home that trusts the folder, a setting Codex renamed would pass.
    const trusting = homeFrom(signedIn)
    fs.writeFileSync(
      path.join(trusting, 'config.toml'),
      `[projects.${JSON.stringify(tree)}]\ntrust_level = "trusted"\n`
    )

    async function verbosityUnder(configDir: string) {
      const read = ConfigRead.parse(
        await askAppServer(folder ?? '', configDir, {
          method: 'config/read',
          params: {cwd: tree},
        })
      )

      return read.config.model_verbosity
    }

    try {
      expect(await verbosityUnder(home)).toBeNull()
      expect(await verbosityUnder(trusting)).toBe('high')
    } finally {
      for (const made of [tree, home, trusting])
        fs.rmSync(made, {recursive: true, force: true})
    }
  }, 60_000)
})

describe.skipIf(!folder)('a live Codex nobody signed in to', () => {
  it('fails a Prompt over Codex’s text cap as too long, with both counts', async () => {
    if (!folder) return

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))
    const idle = heldIdle()
    const exits: Promise<unknown>[] = []

    const driver = createCodexDriver({
      store: fakeStore().client,
      spawn: (command, options) => {
        const child = spawnCodex(command, options)
        exits.push(once(child, 'exit').catch(() => undefined))

        return child
      },
      whenIdle: idle.whenIdle,
    })

    try {
      const events = await Array.fromAsync(
        driver.startReply({
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
          model: MODEL,
          systemPrompt: '',
          // Two UTF-16 units each: Codex counts code points, not `length`.
          prompt: {
            text: '😀'.repeat(1_100_000),
            attachments: [],
            messageId: crypto.randomUUID(),
          },
          vendorProgram: {
            program: {
              path: folder,
              build: {
                url: 'https://example.com/codex.tar.gz',
                sha256: '0'.repeat(64),
                size: 1,
                archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
              },
            },
            configDir: home,
          },
          treeFolder: treeFolder(),
          session: null,
          thread: [],
          compactionSettings: DEFAULT_COMPACTION_SETTINGS,
          systemPromptChanged: false,
          tools: DEFAULT_TREE_TOOLS,
          permissionMode: 'full-access',
          hiddenFolders: [],
          treesFolder: '/trees',
          grants: [],
        })
      )

      const last = events.at(-1)
      const failure = last?.type === 'RUN_FINISHED' ? last.failure : undefined

      expect(failure).toMatchObject({code: 'too-long', promptChars: 1_100_000})
      expect(failure?.maxPromptChars).toBeLessThan(1_100_000)
      expect(events.some(event => event.type === 'PROMPT_RECORDED')).toBe(false)

      idle.pass()
      await Promise.all(exits)
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  })

  it('[dep:codex-inject-items] [dep:lost-session-refusals] [dep:reply-labels-unwritten] takes over a Thread Claude wrote as its own history, writes no label, and rebuilds a thread it has no rollout of', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const {reply, closed, threadsStarted} = threadReplies(folder, home)
    const asked = 'What color and what animal did we pick? Just the two words.'

    try {
      const taken = await reply(asked, null, FROM_CLAUDE)

      expect(taken.text).toMatch(/teal/i)
      expect(taken.text).toMatch(/otter/i)
      expect(taken.text).not.toMatch(/\[Reply written by/)
      expect(threadsStarted()).toBe(1)

      const lost = crypto.randomUUID()

      const rebuilt = await reply(
        asked,
        {type: 'continue', sessionId: lost, messageId: crypto.randomUUID()},
        FROM_CLAUDE
      )

      expect(rebuilt.text).toMatch(/teal/i)
      expect(rebuilt.text).toMatch(/otter/i)
      expect(rebuilt.text).not.toMatch(/\[Reply written by/)
      expect(rebuilt.session.sessionId).not.toBe(lost)
      expect(threadsStarted()).toBe(2)

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-data-url-images] [dep:codex-injected-images] reads an image sent as a data URL with a Prompt, and one injected with a Thread Claude wrote, opening neither from its path', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const files = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-files-'))
    const {reply, closed, threadsStarted} = threadReplies(folder, home)

    try {
      const heron = pngShowing(files, 'HERON')

      const sent = await reply(
        'Without using any tool: what word does the attached image show? Just the word.',
        null,
        [],
        [heron]
      )

      expect(sent.text).toMatch(/heron/i)
      // The image's path is in the Prompt too: a tool call would read it there.
      expect(sent.calls).toEqual([])

      const fromClaude: Thread = [
        {
          prompt: 'Keep this image in mind.',
          attachments: [heron],
          reply: [{type: 'text', text: 'Noted.'}],
          label: '[Reply written by Haiku 5.5]',
        },
      ]

      const injected = await reply(
        'Without using any tool: what word did the image I sent show? Just the word.',
        null,
        fromClaude
      )

      expect(injected.text).toMatch(/heron/i)
      expect(injected.calls).toEqual([])
      expect(threadsStarted()).toBe(2)

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(files, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-opens-attachment-path] opens a file it is given only the path line of, with a command', async () => {
    if (!folder || !signedIn) return

    const home = homeFrom(signedIn)
    const files = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-files-'))
    const {reply, closed} = threadReplies(folder, home)

    try {
      const memo = fileHolding(
        files,
        'memo.txt',
        Buffer.from('The secret word is MAPLE.\n', 'utf8')
      )

      const sent = await reply(
        'What is the secret word in the attached file? Just the word.',
        null,
        [],
        [memo]
      )

      expect(sent.text).toMatch(/maple/i)
      expect(sent.calls.some(call => call.args.includes('memo.txt'))).toBe(true)

      await closed()
    } finally {
      fs.rmSync(home, {recursive: true, force: true})
      fs.rmSync(files, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:codex-protocol-types] generates the protocol/ types committed for it', () => {
    if (!folder) return

    const {version} = PinnedManifest.parse(
      JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))
    ).vendorPrograms.codex

    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-protocol-'))
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))

    try {
      // The standalone app-server has no generator: the full `codex` does.
      const generated = spawnSync(
        'bunx',
        [`@openai/codex@${version}`, 'app-server', 'generate-ts', '--out', out],
        {encoding: 'utf8', env: {...process.env, CODEX_HOME: home}}
      )

      expect({
        status: generated.status,
        stderr: generated.stderr,
      }).toMatchObject({
        status: 0,
      })

      const committed = filesIn(PROTOCOL)
      const fresh = filesIn(out)
      const names = new Set([...committed.keys(), ...fresh.keys()])

      expect(
        [...names].filter(name => committed.get(name) !== fresh.get(name))
      ).toEqual([])
    } finally {
      fs.rmSync(out, {recursive: true, force: true})
      fs.rmSync(home, {recursive: true, force: true})
    }
  }, 300_000)

  it('[dep:self-updates-off] holds every setting the app passes it', () => {
    if (!folder) return

    const program = programIn(folder)

    const binary = fs.readFileSync(program)

    // Linux's arguments hold every other platform's, plus `allow_login_shell`.
    // The binary holds `agents` and `enabled` apart, so `[dep:codex-subagents-off]` checks that one.
    const settings = codexArgs('linux')
      .filter(arg => arg !== '-c')
      .map(arg => arg.split('=')[0]?.replace(/^features\./, '') ?? '')
      .filter(name => name !== 'agents.enabled')

    expect(settings.length).toBeGreaterThan(0)
    expect(settings.filter(name => !binary.includes(name))).toEqual([])
  })

  it('[dep:codex-sign-in-port-and-refusal] holds the refused-workspace wording the app matches, and takes the sign-in port for a sign-in', async () => {
    if (!folder) return

    const program = programIn(folder)

    expect(fs.readFileSync(program).includes(NOT_ENTITLED)).toBe(true)

    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-live-codex-'))

    const server = await startAppServer(
      spawnCodex,
      {command: program, args: codexArgs(process.platform)},
      {cwd: home, env: codexEnvironment(process.env, home)}
    )

    try {
      expect(
        await portFree(SIGN_IN_PORT),
        'another sign-in holds the port: close it and run again'
      ).toBe(true)

      const login = await server.request('account/login/start', {
        type: 'chatgpt',
      })

      await expect.poll(async () => portFree(SIGN_IN_PORT)).toBe(false)
      await server.request('account/login/cancel', {loginId: login.loginId})
    } finally {
      await server.close()
      fs.rmSync(home, {recursive: true, force: true})
    }
  })
})
