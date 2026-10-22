import type {QueryClient} from '@tanstack/react-query'
import type {CommandResult} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {StreamingReply} from '@uz/contract/turns'

import {Store} from '@tanstack/react-store'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'

export type Turns = CommandResult<'tree.turns'>

/** Replies being written, by Reply id. Saved Turns live in TanStack Query. */
export type ReplyStore = Store<Record<string, StreamingReply>>

export function createReplyStore(): ReplyStore {
  return new Store<Record<string, StreamingReply>>({})
}

export function turnsKey(treeId: string) {
  return ['turns', treeId] as const
}

function without(replies: Record<string, StreamingReply>, replyId: string) {
  return Object.fromEntries(
    Object.entries(replies).filter(([id]) => id !== replyId)
  )
}

/**
 * Folds a live event into the streaming Replies. A `SNAPSHOT` replaces them
 * with what main has in progress; at `RUN_FINISHED` the Reply moves into the
 * saved Turns, which main has just written the same way.
 */
export function applyLiveEvent(
  event: AppEvent,
  store: ReplyStore,
  queryClient: QueryClient
) {
  if (event.type === 'SNAPSHOT') {
    store.setState(() =>
      Object.fromEntries(event.replies.map(reply => [reply.replyId, reply]))
    )
    void queryClient.invalidateQueries({queryKey: ['turns']})

    return
  }

  if (!('replyId' in event)) return

  const {treeId, replyId} = event
  const current = store.state[replyId] ?? {...NEW_REPLY, treeId, replyId}
  const next = foldReplyEvent(current, event)

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
    store.setState(replies => without(replies, replyId))

    return
  }

  if (next !== current || !(replyId in store.state)) {
    store.setState(replies => ({...replies, [replyId]: next}))
  }
}
