import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {UUID} from 'node:crypto'

import {createInbox} from '#modules/inbox/main'
import {setTimeout as delay} from 'node:timers/promises'

/** Far longer than a token refresh; a `claude` still running then is stuck. */
const CLOSE_TIMEOUT_MS = 30_000

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => Query

type Input = {kind: 'prompt'; text: string; uuid: UUID} | {kind: 'end'}

/** One `claude` kept open between Prompts; `messageId` is where it continues. */
export interface ClaudeSession {
  readonly sessionId: string | null
  messageId: string | null
  /** Whether `claude` has started; false while it may still refuse to. */
  readonly started: boolean
  readonly ended: boolean
  /** Yields up to the Prompt's `result`; `claude` stores it as `uuid`. */
  send(text: string, uuid: UUID): AsyncGenerator<SDKMessage>
  /** Resolves once `claude` takes it; the `result` still follows on `send`. */
  interrupt(): Promise<void>
  /** Waits for `claude` to exit by itself, to finish writing; else stops it. */
  close(): Promise<void>
}

export function openSession(query: QueryFn, options: Options): ClaudeSession {
  const inbox = createInbox<Input>()

  async function* prompts(): AsyncGenerator<SDKUserMessage> {
    for (;;) {
      const input = await inbox.next()

      if (input.kind === 'end') return

      yield {
        type: 'user',
        message: {role: 'user', content: input.text},
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

    async *send(text, uuid) {
      inbox.push({kind: 'prompt', text, uuid})

      for (;;) {
        const step = await next()

        if (step.done) return

        const message = step.value

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
