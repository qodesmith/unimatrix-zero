import type {Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk'

import {setTimeout as delay} from 'node:timers/promises'

/**
 * As long as the SDK gives `claude` to start. `claude` is normally heard within
 * seconds of the Prompt, offline included; a network stalled before it starts
 * can keep it silent for hours.
 */
export const HEARD_WITHIN_MS = 60_000

/** A Reply given up on before `claude` was heard: Stop, or the wait ran out. */
export interface Silent {
  silent: 'stopped' | 'timed-out'
}

/**
 * The first of `messages`, unless Stop or `withinMs` comes first. Stop is
 * the Reply's until then.
 */
export async function firstHeard(
  messages: AsyncGenerator<SDKMessage>,
  run: ReplyRun,
  withinMs: number
): Promise<IteratorResult<SDKMessage> | Silent> {
  const {promise: stopped, resolve: stop} = Promise.withResolvers<Silent>()
  const unstoppable = run.stoppable(async () => stop({silent: 'stopped'}))
  const waited = new AbortController()

  try {
    return await Promise.race([
      messages.next(),
      stopped,
      delay(withinMs, {silent: 'timed-out'} as const, {signal: waited.signal}),
    ])
  } finally {
    waited.abort()
    unstoppable()
  }
}

export async function* startingWith<T>(first: T, rest: AsyncGenerator<T>) {
  yield first
  yield* rest
}

export function silentEnding(
  ids: {treeId: string; replyId: string},
  {silent}: Silent,
  withinMs: number
): Ending {
  const type = 'RUN_FINISHED'

  if (silent === 'stopped') return {finished: {...ids, type, status: 'stopped'}}

  return {
    finished: {
      ...ids,
      type,
      status: 'failed',
      failure: {
        code: 'connection-lost',
        message: `Claude didn’t answer for ${withinMs / 1000} seconds.`,
      },
    },
  }
}
