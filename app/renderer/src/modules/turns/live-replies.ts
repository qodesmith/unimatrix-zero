import type {ReplyRunEvent, ReplyRunState} from './reply-run/machine'
import type {QueryClient} from '@tanstack/react-query'
import type {AppEvent} from '@uz/contract/events'
import type {ReplyEvent, StreamingReply} from '@uz/contract/turns'

import {Store} from '@tanstack/react-store'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'

import {replyRunTransition} from './reply-run/machine'
import {updateSavedReply, withProgress} from './saved-turns'

/** A run of the Model's reasoning; display only, never stored. */
export interface ThinkingBlock {
  text: string
  /** The count of content parts before this thinking began. */
  beforePart: number
  startedAt: number
  endedAt: number | null
}

interface LiveState {
  /** Streaming Replies by Reply id; saved Turns live in TanStack Query. */
  replies: Record<string, StreamingReply>
  /** By Reply id, kept after the Reply finishes; only a reload clears it. */
  thinking: Record<string, ThinkingBlock[]>
  /** By Reply id, from a Stop or Retry asked until the machine is idle again. */
  runs: Record<string, ReplyRunState>
  /**
   * By streaming Reply id, from the vendor program's retry notice or a lost
   * connection to its next content.
   */
  waiting: Record<string, Wait>
}

export type Wait = 'busy' | 'reconnecting'

export type ReplyStore = Store<LiveState>

export function createReplyStore(): ReplyStore {
  return new Store<LiveState>({
    replies: {},
    thinking: {},
    runs: {},
    waiting: {},
  })
}

function without<T>(byReply: Record<string, T>, replyId: string) {
  return Object.fromEntries(
    Object.entries(byReply).filter(([id]) => id !== replyId)
  )
}

export function withRun(
  runs: LiveState['runs'],
  replyId: string,
  state: ReplyRunState
) {
  return state.status === 'idle'
    ? without(runs, replyId)
    : {...runs, [replyId]: state}
}

const MOVES_ON: ReadonlySet<ReplyEvent['type']> = new Set([
  'TEXT_DELTA',
  'TEXT_REPLACE',
  'TOOL_CALL_START',
  'RUN_FINISHED',
])

/** A Thinking block stays open across `TOKENS`, which can come mid-thought. */
function foldThinking(
  blocks: ThinkingBlock[],
  event: ReplyEvent,
  partsSoFar: number,
  now: number
): ThinkingBlock[] {
  const last = blocks.at(-1)
  const open = last?.endedAt === null ? last : null

  if (event.type === 'REASONING_DELTA') {
    return open
      ? [...blocks.slice(0, -1), {...open, text: open.text + event.delta}]
      : [
          ...blocks,
          {
            text: event.delta,
            beforePart: partsSoFar,
            startedAt: now,
            endedAt: null,
          },
        ]
  }

  return open && MOVES_ON.has(event.type)
    ? [...blocks.slice(0, -1), {...open, endedAt: now}]
    : blocks
}

/** A Subagent's reasoning isn't the Reply's; a Retry thinks from nothing. */
function thinkingAfter(
  thinking: LiveState['thinking'],
  event: ReplyEvent,
  current: StreamingReply,
  now: number
) {
  const {replyId} = event
  const blocks = thinking[replyId] ?? []

  if ('subagentId' in event && event.subagentId !== undefined) return thinking

  const startsOver = event.type === 'RUN_STARTED' && blocks.length > 0

  const nextBlocks = foldThinking(
    startsOver ? [] : blocks,
    event,
    current.content.length,
    now
  )

  return nextBlocks === blocks ? thinking : {...thinking, [replyId]: nextBlocks}
}

const RUN_EVENTS: Partial<Record<ReplyEvent['type'], ReplyRunEvent>> = {
  RUN_STARTED: {type: 'runStarted'},
  RUN_FINISHED: {type: 'runFinished'},
}

function runsAfter(runs: LiveState['runs'], event: ReplyEvent) {
  const before = runs[event.replyId]
  const runEvent = RUN_EVENTS[event.type]

  if (!before || !runEvent) return runs

  const after = replyRunTransition(before, runEvent)

  return after === before ? runs : withRun(runs, event.replyId, after)
}

const ENDS_WAIT: ReadonlySet<ReplyEvent['type']> = new Set([
  'RUN_STARTED',
  'TEXT_DELTA',
  'TEXT_REPLACE',
  'REASONING_DELTA',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_RESULT',
  'RUN_FINISHED',
])

function waitingAfter(waiting: LiveState['waiting'], event: ReplyEvent) {
  const {replyId} = event

  if (event.type === 'RECONNECTING') {
    const wait: Wait = event.busy ? 'busy' : 'reconnecting'

    return waiting[replyId] === wait ? waiting : {...waiting, [replyId]: wait}
  }

  return waiting[replyId] && ENDS_WAIT.has(event.type)
    ? without(waiting, replyId)
    : waiting
}

/** Neither vendor program says when the connection is back; content does. */
export function markStreamingWaiting(store: ReplyStore) {
  store.setState(state => ({
    ...state,
    waiting: Object.fromEntries(
      Object.keys(state.replies).map(replyId => [
        replyId,
        'reconnecting' as const,
      ])
    ),
  }))
}

/**
 * A `SNAPSHOT` replaces the streaming Replies; at `RUN_FINISHED` the Reply
 * moves into the saved Turns, which main has just written the same way.
 */
export function applyLiveEvent(
  event: AppEvent,
  store: ReplyStore,
  queryClient: QueryClient,
  now: () => number = Date.now
) {
  if (event.type === 'SNAPSHOT') {
    store.setState(state => ({
      ...state,
      replies: Object.fromEntries(
        event.replies.map(reply => [reply.replyId, reply])
      ),
      waiting: Object.fromEntries(
        event.replies.flatMap(({replyId}) => {
          const wait = state.waiting[replyId]

          return wait ? [[replyId, wait]] : []
        })
      ),
    }))
    void queryClient.invalidateQueries({queryKey: ['turns']})

    return
  }

  if (!('replyId' in event)) return

  const {treeId, replyId} = event
  const {replies, thinking, runs, waiting} = store.state
  const current = replies[replyId] ?? {...NEW_REPLY, treeId, replyId}
  const next = foldReplyEvent(current, event)
  const nextThinking = thinkingAfter(thinking, event, current, now())
  const nextRuns = runsAfter(runs, event)
  const nextWaiting = waitingAfter(waiting, event)

  if (event.type === 'RUN_FINISHED') {
    updateSavedReply(queryClient, event, saved => withProgress(saved, next))
    store.setState(() => ({
      replies: without(replies, replyId),
      thinking: nextThinking,
      runs: nextRuns,
      waiting: nextWaiting,
    }))

    return
  }

  const changed = next !== current || !(replyId in replies)

  if (
    changed ||
    nextThinking !== thinking ||
    nextRuns !== runs ||
    nextWaiting !== waiting
  ) {
    store.setState(() => ({
      replies: changed ? {...replies, [replyId]: next} : replies,
      thinking: nextThinking,
      runs: nextRuns,
      waiting: nextWaiting,
    }))
  }
}
