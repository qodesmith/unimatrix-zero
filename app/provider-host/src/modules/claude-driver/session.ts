import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import {createInbox} from '#modules/inbox/main'
import {setTimeout as delay} from 'node:timers/promises'

/** Far longer than a token refresh; a `claude` still running then is stuck. */
const CLOSE_TIMEOUT_MS = 30_000

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => Query

type Input = {kind: 'prompt'; text: string} | {kind: 'end'}

/**
 * One `claude` in streaming-input mode: a Provider session kept open between
 * Prompts. Its session id is known once `claude` starts; `messageId` is
 * Claude's last message, where the session's next Prompt continues from.
 */
export interface ClaudeSession {
  readonly sessionId: string | null
  messageId: string | null
  /** Whether `claude` has started; false while it may still refuse to. */
  readonly started: boolean
  /** Whether `claude` has ended, by itself or by `close`. */
  readonly ended: boolean
  /** Sends a Prompt and yields what comes back, up to its `result`. */
  send(text: string): AsyncGenerator<SDKMessage>
  /**
   * Ends `claude`'s input and waits for it to exit by itself, so it can
   * finish writing; one that is stuck is stopped.
   */
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

  /** Reads to the end, which comes once `claude` has exited. */
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

    async *send(text) {
      inbox.push({kind: 'prompt', text})

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
