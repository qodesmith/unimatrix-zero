import type {RecordedLine} from './replay'
import type {SpawnOptions, SpawnedProcess} from '@anthropic-ai/claude-agent-sdk'

import {
  HOME_STAND_IN,
  buildOf,
  claimRecordings,
  replaceAcross,
  tempFolderNames,
} from '#modules/test-recordings/main'
import os from 'node:os'
import {createInterface} from 'node:readline'
import {PassThrough} from 'node:stream'
import {z} from 'zod'

import {
  APP_VARIABLE,
  CONFIG_FOLDER_STAND_IN,
  RecordedMessageSchema,
} from './replay'
import {projectKeyOf} from './transcripts'

type RecordedMessage = z.infer<typeof RecordedMessageSchema>

const STAND_IN_UUID = '00000000-0000-4000-8000-000000000000'

const InitializeAnswerSchema = z.looseObject({
  type: z.literal('control_response'),
  response: z.looseObject({
    response: z.looseObject({account: z.looseObject({email: z.string()})}),
  }),
})

const SessionInitSchema = z.looseObject({
  type: z.literal('system'),
  subtype: z.literal('init'),
})

const ACCOUNT_ID = /"(?:organization|account)_?uuid":"([^"]+)"/gi

function withoutAccountLists(message: RecordedMessage): RecordedMessage {
  const answer = InitializeAnswerSchema.safeParse(message)

  if (answer.success) {
    const {response} = answer.data

    return {
      ...answer.data,
      response: {
        ...response,
        response: {...response.response, commands: [], agents: []},
      },
    }
  }

  if (!SessionInitSchema.safeParse(message).success) return message

  return {...message, slash_commands: [], agents: [], skills: [], plugins: []}
}

const DeltaSchema = z.looseObject({
  type: z.literal('stream_event'),
  session_id: z.string(),
  event: z.looseObject({
    type: z.literal('content_block_delta'),
    index: z.number(),
    delta: z.looseObject({
      text: z.string().optional(),
      partial_json: z.string().optional(),
      thinking: z.string().optional(),
    }),
  }),
})

const BlockStartSchema = z.looseObject({
  type: z.literal('stream_event'),
  session_id: z.string(),
  event: z.looseObject({
    type: z.literal('content_block_start'),
    index: z.number(),
  }),
})

const STREAMED_FIELDS = ['text', 'partial_json', 'thinking'] as const

interface Piece {
  at: number
  field: (typeof STREAMED_FIELDS)[number]
  text: string
}

function blocksOf(lines: RecordedLine[]) {
  const open = new Map<string, Piece[]>()
  const blocks: Piece[][] = []

  for (const [at, line] of lines.entries()) {
    if (line.kind !== 'out') continue

    const started = BlockStartSchema.safeParse(line.message)

    if (started.success) {
      const {session_id: session, event} = started.data

      for (const field of STREAMED_FIELDS) {
        const key = `${session}:${event.index}:${field}`
        const block = open.get(key)

        if (block) blocks.push(block)
        open.delete(key)
      }
    }

    const delta = DeltaSchema.safeParse(line.message)

    if (!delta.success) continue

    const {session_id: session, event} = delta.data

    for (const field of STREAMED_FIELDS) {
      const text = event.delta[field]

      if (text === undefined) continue

      const key = `${session}:${event.index}:${field}`
      open.set(key, [...(open.get(key) ?? []), {at, field, text}])
    }
  }

  return [...blocks, ...open.values()]
}

/** A content block streams in pieces, so one path can be split between them. */
function withDeltasScrubbed(
  lines: RecordedLine[],
  replacements: (readonly [string, string])[]
) {
  const scrubbed = new Map<number, Record<string, string>>()

  for (const block of blocksOf(lines)) {
    let texts = block.map(piece => piece.text)

    for (const [from, to] of replacements) {
      texts = replaceAcross(texts, from, to)
    }

    for (const [at, piece] of block.entries()) {
      scrubbed.set(piece.at, {
        ...scrubbed.get(piece.at),
        [piece.field]: texts[at] ?? '',
      })
    }
  }

  return lines.map((line, at) => {
    const fields = scrubbed.get(at)
    const delta = line.kind === 'out' && DeltaSchema.safeParse(line.message)

    if (!fields || !delta || !delta.success) return line

    const {event} = delta.data

    return {
      ...line,
      message: {
        ...delta.data,
        event: {...event, delta: {...event.delta, ...fields}},
      },
    }
  })
}

function scrub(lines: RecordedLine[]) {
  const listed = lines.map(line =>
    line.kind === 'out'
      ? {...line, message: withoutAccountLists(line.message)}
      : line
  )

  const emails = lines.flatMap(line => {
    const answer =
      line.kind === 'out'
        ? InitializeAnswerSchema.safeParse(line.message)
        : null

    return answer?.success ? [answer.data.response.response.account.email] : []
  })

  const ids = listed.flatMap(line =>
    [...JSON.stringify(line).matchAll(ACCOUNT_ID)].flatMap(([, id]) =>
      id ? [id] : []
    )
  )

  const temp = tempFolderNames()

  const replacements: (readonly [string, string])[] = [
    ...temp.paths,
    ...temp.projectKeys,
    [os.homedir(), HOME_STAND_IN],
    ...emails.map(email => [email, 'sam@example.com'] as const),
    ...ids.map(id => [id, STAND_IN_UUID] as const),
    [os.userInfo().username, 'sam'],
  ]

  return withDeltasScrubbed(listed, replacements)
    .map(line => {
      let scrubbed = JSON.stringify(line)

      for (const [from, to] of replacements) {
        scrubbed = scrubbed.replaceAll(from, to)
      }

      return `${scrubbed}\n`
    })
    .join('')
}

function appVariables(env: SpawnOptions['env'], configDir: string) {
  return Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      value !== undefined && APP_VARIABLE.test(name)
        ? [[name, value.replaceAll(configDir, CONFIG_FOLDER_STAND_IN)]]
        : []
    )
  )
}

/**
 * Records each `claude` into `files` in the order they start, stamped with its
 * build, once it exits, unless a later recorder has claimed the file.
 * `configDir` is the app's config folder, which the SDK swaps on a resume.
 */
export function createRecorder(
  spawn: (options: SpawnOptions) => SpawnedProcess,
  files: string[],
  configDir: string
) {
  const written: Promise<void>[] = []
  const write = claimRecordings(files)

  function record(options: SpawnOptions): SpawnedProcess {
    const file = files[written.length]

    if (!file) throw new Error('More claude processes ran than were recorded.')

    const lines: RecordedLine[] = [
      {
        kind: 'start',
        build: buildOf('claude', options.command),
        configDir: options.env.CLAUDE_CONFIG_DIR ?? '',
        projectKey: projectKeyOf(options.cwd ?? '.'),
        cwd: options.cwd ?? '',
        args: options.args,
        env: appVariables(options.env, configDir),
      },
    ]

    const child = spawn(options)
    const input = new PassThrough()

    function listen(stream: NodeJS.ReadableStream, kind: 'in' | 'out') {
      createInterface({input: stream}).on('line', text => {
        lines.push({
          kind,
          message: RecordedMessageSchema.parse(JSON.parse(text)),
        })
      })
    }

    listen(input, 'in')
    listen(child.stdout, 'out')
    input.on('end', () => lines.push({kind: 'end'}))
    input.pipe(child.stdin)

    written.push(
      (async () => {
        await new Promise(resolve => {
          child.once('exit', resolve)
        })
        write(file, scrub(lines))
      })()
    )

    return Object.assign(child, {stdin: input})
  }

  return {
    spawn: record,
    async done() {
      await Promise.all(written)
    },
  }
}
