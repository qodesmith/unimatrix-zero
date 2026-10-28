import type {
  PromptDropped,
  PromptRecorded,
  ProviderDriver,
  ReplyRecorded,
  ReplyRequest,
} from '@uz/contract/host'
import type {ReplyEvent, RunFailure} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

type FinishedStatus = RunFinished['status']

/** What a driver streams between the run's `RUN_STARTED` and `RUN_FINISHED`. */
export type ContentEvent = Exclude<
  ReplyEvent,
  {type: 'RUN_STARTED' | 'RUN_FINISHED'}
>

/** How the vendor program ended the Reply; a failed one is never recorded. */
export interface Ending {
  finished: RunFinished
  recorded?: ReplyRecorded | null
}

/** Thrown when the vendor program goes away while it writes the Reply. */
export class ProgramCrashed extends Error {}

export interface ReplyRun {
  /**
   * Stop now interrupts the vendor program this way; one asked before is passed
   * on at once. Call the returned function once that no longer stops it.
   */
  stoppable(interrupt: () => Promise<void>): () => void
  /** Runs once the Reply has finished, however it did, before it's sent on. */
  afterward(cleanUp: (status: FinishedStatus) => void): void
}

/** The vendor program's part of one Reply: its content, then how it ended. */
export type WriteReply = (
  request: ReplyRequest,
  run: ReplyRun
) => AsyncGenerator<ContentEvent | PromptRecorded | PromptDropped, Ending>

interface Writing {
  interrupt: (() => Promise<void>) | null
  stopAsked: boolean
  cleanUps: ((status: FinishedStatus) => void)[]
}

interface ReplyRunsOptions {
  /** When the Provider's full limit windows lift, in seconds since the epoch. */
  limitLifts?: () => number | undefined
}

/**
 * A Reply's run around a driver's `write`: `RUN_STARTED` first, exactly one
 * `RUN_FINISHED` last, and a throw failed with its reason.
 */
export function createReplyRuns(
  write: WriteReply,
  {limitLifts = () => undefined}: ReplyRunsOptions = {}
): Pick<ProviderDriver, 'startReply' | 'stop'> {
  const writing = new Map<string, Writing>()

  function runOf(entry: Writing): ReplyRun {
    return {
      stoppable(interrupt) {
        entry.interrupt = interrupt

        if (entry.stopAsked) void interrupt().catch(() => undefined)

        return () => {
          if (entry.interrupt === interrupt) entry.interrupt = null
        }
      },
      afterward(cleanUp) {
        entry.cleanUps.push(cleanUp)
      },
    }
  }

  /** A Reply its caller walks away from has failed, for the clean-ups. */
  async function* ended(
    request: ReplyRequest,
    entry: Writing
  ): AsyncGenerator<ContentEvent | PromptRecorded | PromptDropped, Ending> {
    let endedAs: FinishedStatus = 'failed'

    try {
      const ending = yield* write(request, runOf(entry))
      endedAs = ending.finished.status

      return ending
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      const failure: RunFailure =
        error instanceof ProgramCrashed
          ? {code: 'program-crashed', message}
          : failureOf(message, limitLifts())

      return {
        finished: {
          treeId: request.treeId,
          replyId: request.replyId,
          type: 'RUN_FINISHED',
          status: 'failed',
          failure,
        },
      }
    } finally {
      writing.delete(request.replyId)

      for (const cleanUp of entry.cleanUps) cleanUp(endedAs)
    }
  }

  async function* startReply(
    request: ReplyRequest
  ): AsyncGenerator<
    ReplyEvent | PromptRecorded | PromptDropped | ReplyRecorded
  > {
    const entry: Writing = {interrupt: null, stopAsked: false, cleanUps: []}

    writing.set(request.replyId, entry)
    yield {
      treeId: request.treeId,
      replyId: request.replyId,
      type: 'RUN_STARTED',
    }

    const {finished, recorded} = yield* ended(request, entry)

    if (recorded && finished.status !== 'failed') yield recorded

    yield finished
  }

  /** The Reply's stream still goes on to its `RUN_FINISHED`. */
  async function stop(replyId: string) {
    const entry = writing.get(replyId)

    if (!entry) return

    if (entry.interrupt) await entry.interrupt()
    else entry.stopAsked = true
  }

  return {startReply, stop}
}
