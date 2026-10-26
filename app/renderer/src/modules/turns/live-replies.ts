import type {QueryClient} from '@tanstack/react-query'
import type {CommandResult} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {ReplyEvent, StreamingReply} from '@uz/contract/turns'

import {Store} from '@tanstack/react-store'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'

export type Turns = CommandResult<'tree.turns'>

/** A run of the Model's reasoning; display only, never stored. */
export interface ThinkingBlock {
  text: string
  /** The count of content parts before this thinking began. */
  beforePart: number
  startedAt: number
  /** Null while the Model still thinks. */
  endedAt: number | null
}

interface LiveState {
  /** Streaming Replies by Reply id; saved Turns live in TanStack Query. */
  replies: Record<string, StreamingReply>
  /** By Reply id, kept after the Reply finishes; only a reload clears it. */
  thinking: Record<string, ThinkingBlock[]>
}

export type ReplyStore = Store<LiveState>

export function createReplyStore(): ReplyStore {
  return new Store<LiveState>({replies: {}, thinking: {}})
}

export function turnsKey(treeId: string) {
  return ['turns', treeId] as const
}

function without(replies: Record<string, StreamingReply>, replyId: string) {
  return Object.fromEntries(
    Object.entries(replies).filter(([id]) => id !== replyId)
  )
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
    }))
    void queryClient.invalidateQueries({queryKey: ['turns']})

    return
  }

  if (!('replyId' in event)) return

  const {treeId, replyId} = event
  const {replies, thinking} = store.state
  const current = replies[replyId] ?? {...NEW_REPLY, treeId, replyId}
  const next = foldReplyEvent(current, event)
  const blocks = thinking[replyId] ?? []
  const startsOver = event.type === 'RUN_STARTED' && blocks.length > 0

  const nextBlocks =
    'subagentId' in event && event.subagentId !== undefined
      ? blocks
      : foldThinking(
          startsOver ? [] : blocks,
          event,
          current.content.length,
          now()
        )

  const nextThinking =
    nextBlocks === blocks ? thinking : {...thinking, [replyId]: nextBlocks}

  if (event.type === 'RUN_FINISHED') {
    const {status, content, contextSize, contextWindow, failure} = next

    queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
      turns
        ? {
            ...turns,
            replies: turns.replies.map(reply =>
              reply.id === replyId
                ? {
                    ...reply,
                    status,
                    content,
                    contextSize,
                    contextWindow,
                    failure,
                  }
                : reply
            ),
          }
        : turns
    )
    store.setState(() => ({
      replies: without(replies, replyId),
      thinking: nextThinking,
    }))

    return
  }

  const changed = next !== current || !(replyId in replies)

  if (changed || nextThinking !== thinking) {
    store.setState(() => ({
      replies: changed ? {...replies, [replyId]: next} : replies,
      thinking: nextThinking,
    }))
  }
}
