import type {Ending, ReplyRun} from '#modules/reply-runs/main'
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'

export const HEARD_WITHIN_MS = 60_000

/** Calls `giveUp` once `claude` is silent too long; the return cancels it. */
export type WhenSilent = (giveUp: () => void) => () => void

export interface Silent {
  silent: 'stopped' | 'timed-out'
}

export async function firstHeard(
  messages: AsyncGenerator<SDKMessage>,
  run: ReplyRun,
  whenSilent: WhenSilent
): Promise<IteratorResult<SDKMessage> | Silent> {
  const {promise: givenUp, resolve: giveUp} = Promise.withResolvers<Silent>()
  const unstoppable = run.stoppable(async () => giveUp({silent: 'stopped'}))
  const stopWaiting = whenSilent(() => giveUp({silent: 'timed-out'}))

  try {
    return await Promise.race([messages.next(), givenUp])
  } finally {
    stopWaiting()
    unstoppable()
  }
}

export async function* startingWith<T>(first: T, rest: AsyncGenerator<T>) {
  yield first
  yield* rest
}

export function silentEnding(
  ids: Pick<ReplyRequest, 'treeId' | 'replyId'>,
  {silent}: Silent
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
        message: 'Claude didn’t answer for a minute.',
      },
    },
  }
}
