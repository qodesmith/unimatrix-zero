import type {RecordedLine} from './replay'
import type {SpawnOptions, SpawnedProcess} from '@anthropic-ai/claude-agent-sdk'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'
import {PassThrough} from 'node:stream'
import {z} from 'zod'

import {RecordedMessageSchema} from './replay'
import {projectKeyOf} from './transcripts'

type RecordedMessage = z.infer<typeof RecordedMessageSchema>

const STAND_IN_UUID = '00000000-0000-4000-8000-000000000000'

/** `claude`'s answer to the SDK's initialize request, naming the account. */
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

/** Without the account's own commands, agents, skills and plugins. */
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

/**
 * A recording fit to keep in the repo: the account's email, name, ids and
 * home folder replaced with stand-ins, and its own lists emptied.
 */
function scrub(lines: RecordedLine[]) {
  const texts = lines.map(line =>
    JSON.stringify(
      line.kind === 'out'
        ? {...line, message: withoutAccountLists(line.message)}
        : line
    )
  )

  const emails = lines.flatMap(line => {
    const answer =
      line.kind === 'out'
        ? InitializeAnswerSchema.safeParse(line.message)
        : null

    return answer?.success ? [answer.data.response.response.account.email] : []
  })

  const ids = texts.flatMap(text =>
    [...text.matchAll(ACCOUNT_ID)].flatMap(([, id]) => (id ? [id] : []))
  )

  const replacements: [string, string][] = [
    [os.homedir(), '/Users/sam'],
    ...emails.map((email): [string, string] => [email, 'sam@example.com']),
    ...ids.map((id): [string, string] => [id, STAND_IN_UUID]),
    [os.userInfo().username, 'sam'],
  ]

  return texts
    .map(text => {
      let scrubbed = text

      for (const [from, to] of replacements) {
        scrubbed = scrubbed.replaceAll(from, to)
      }

      return `${scrubbed}\n`
    })
    .join('')
}

/**
 * A spawn that records what the SDK and each `claude` exchange, into
 * `files` in the order they start, each written once its `claude` exits.
 */
export function createRecorder(
  spawn: (options: SpawnOptions) => SpawnedProcess,
  files: string[]
) {
  const written: Promise<void>[] = []

  function record(options: SpawnOptions): SpawnedProcess {
    const file = files[written.length]

    if (!file) throw new Error('More claude processes ran than were recorded.')

    const lines: RecordedLine[] = [
      {
        kind: 'start',
        configDir: options.env.CLAUDE_CONFIG_DIR ?? '',
        projectKey: projectKeyOf(options.cwd ?? '.'),
      },
    ]

    const child = spawn(options)
    // What the SDK writes goes through here on its way to `claude`.
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
        await fs.mkdir(path.dirname(file), {recursive: true})
        await fs.writeFile(file, scrub(lines))
      })()
    )

    return Object.assign(child, {stdin: input})
  }

  return {
    spawn: record,
    /** Waits until every recorded `claude` has exited and been written. */
    async done() {
      await Promise.all(written)
    },
  }
}
