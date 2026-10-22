import type {QueryClient} from '@tanstack/react-query'
import type {CommandResult} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {StreamingReply} from '@uz/contract/turns'

import {Store} from '@tanstack/react-store'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'

export type Turns = CommandResult<'tree.turns'>

/**
 * What the Model thought before writing: display only, never stored, so it
 * lives here until the window reloads (PRD §7).
 */
export interface Thinking {
  text: string
  startedAt: number
  /** Set once the Reply moves on from thinking; null while it still thinks. */
  endedAt: number | null
}

interface LiveState {
  /** Replies being written, by Reply id. Saved Turns live in TanStack Query. */
  replies: Record<string, StreamingReply>
  /** By Reply id, kept after the Reply finishes. */
  thinking: Record<string, Thinking>
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

type ReplyEvent = Extract<AppEvent, {replyId: string}>

function foldThinking(
  thinking: Thinking | undefined,
  event: ReplyEvent,
  now: number
): Thinking | undefined {
  if (event.type === 'REASONING_DELTA') {
    return thinking
      ? {...thinking, text: thinking.text + event.delta}
      : {text: event.delta, startedAt: now, endedAt: null}
  }

  if (thinking?.endedAt === null) return {...thinking, endedAt: now}

  return thinking
}

/**
 * Folds a live event into the streaming Replies. A `SNAPSHOT` replaces them
 * with what main has in progress; at `RUN_FINISHED` the Reply moves into the
 * saved Turns, which main has just written the same way. Thinking is folded
 * beside the Reply, since the Reply itself never holds it.
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

  const thought =
    'subagentId' in event && event.subagentId !== undefined
      ? thinking[replyId]
      : foldThinking(thinking[replyId], event, now())

  const nextThinking =
    thought === thinking[replyId]
      ? thinking
      : {...thinking, ...(thought && {[replyId]: thought})}

  if (event.type === 'RUN_FINISHED') {
    const {status, content, contextSize} = next

    queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
      turns
        ? {
            ...turns,
            replies: turns.replies.map(reply =>
              reply.id === replyId
                ? {...reply, status, content, contextSize}
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
