import type {ContentPart} from '#modules/prompt-content/main'
import type {
  ModelInfo,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {UUID} from 'node:crypto'

import {createInbox} from '#modules/inbox/main'
import {setTimeout as delay} from 'node:timers/promises'

/** Far longer than a token refresh; a `claude` still running then is stuck. */
export const CLOSE_TIMEOUT_MS = 30_000

export type QueryFn = (params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options: Options
}) => Query

type Input =
  | {kind: 'prompt'; content: ContentPart[]; uuid: UUID}
  | {kind: 'end'}

type Blocks = Exclude<SDKUserMessage['message']['content'], string>

function blockOf(part: ContentPart): Blocks[number] {
  switch (part.type) {
    case 'text':
      return {type: 'text', text: part.text}
    case 'image':
      return {
        type: 'image',
        source: {type: 'base64', media_type: part.mediaType, data: part.base64},
      }
    case 'document':
      return {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: part.base64,
        },
        title: part.name,
      }
    default:
      throw new Error('Unknown content.')
  }
}

function messageContent(content: ContentPart[]) {
  const [only, ...rest] = content

  return only?.type === 'text' && rest.length === 0
    ? only.text
    : content.map(blockOf)
}

/** One `claude` kept open between Prompts; `messageId` is where it continues. */
export interface ClaudeSession {
  readonly sessionId: string | null
  messageId: string | null
  /** Whether `claude` has started; false while it may still refuse to. */
  readonly started: boolean
  readonly ended: boolean
  /** Yields up to the Prompt's `result`; `claude` stores it as `uuid`. */
  send(content: ContentPart[], uuid: UUID): AsyncGenerator<SDKMessage>
  /** Resolves once `claude` takes it; the `result` still follows on `send`. */
  interrupt(): Promise<void>
  /** Waits for `claude` to exit by itself, to finish writing; else stops it. */
  close(): Promise<void>
  /** What `claude` answered as it started, which the Prompts never wait on. */
  models(): Promise<ModelInfo[]>
}

export function openSession(query: QueryFn, options: Options): ClaudeSession {
  const inbox = createInbox<Input>()

  async function* prompts(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const input = await inbox.next()

      if (input.kind === 'end') return

      yield {
        type: 'user',
        message: {role: 'user', content: messageContent(input.content)},
        parent_tool_use_id: null,
        uuid: input.uuid,
      }
    }
  }

  const running = query({prompt: prompts(), options})
  let sessionId: string | null = null
  let started = false
  let ended = false

  async function next() {
    try {
      const step = await running.next()

      if (step.done) ended = true

      return step
    } catch (error) {
      ended = true
      throw error
    }
  }

  async function drain() {
    while (!ended) await next()
  }

  return {
    get sessionId() {
      return sessionId
    },
    messageId: null,
    get started() {
      return started
    },
    get ended() {
      return ended
    },

    async *send(content, uuid) {
      inbox.push({kind: 'prompt', content, uuid})

      for (;;) {
        const step = await next()

        if (step.done) return

        const message = step.value

        // The previous Prompt's `completed` comes after its `result`.
        if ('command_uuid' in message && message.command_uuid !== uuid) continue

        if (message.type === 'system' && message.subtype === 'init') {
          sessionId = message.session_id
          started = true
        }

        yield message

        if (message.type === 'result') return
      }
    },

    async interrupt() {
      await running.interrupt()
    },

    async models() {
      return (await running.initializationResult()).models
    },

    async close() {
      inbox.push({kind: 'end'})

      const stuck = new AbortController()

      const finished = await Promise.race([
        drain().then(
          () => true,
          () => true
        ),
        delay(CLOSE_TIMEOUT_MS, false, {signal: stuck.signal}),
      ])

      stuck.abort()

      if (!finished) running.close()
    },
  }
}
