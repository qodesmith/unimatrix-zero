import type {ReplyStore} from './live-replies'
import type {Reply} from '@uz/contract/turns'

import {useSelector} from '@tanstack/react-store'
import {createContext, use, useMemo} from 'react'

import {withProgress} from './saved-turns'

export const ReplyStoreContext = createContext<ReplyStore | null>(null)

export function useReplyStore() {
  const store = use(ReplyStoreContext)

  if (!store)
    throw new Error('The live Reply hooks need <LiveReplies> above them')

  return store
}

/**
 * The Reply as it shows now: as far as it has streamed in this window, else
 * as saved. Takes null so a caller's hooks stay in order.
 */
export function useReply(reply: Reply): Reply
export function useReply(reply: Reply | null): Reply | null
export function useReply(reply: Reply | null) {
  const live = useSelector(useReplyStore(), state =>
    reply === null ? undefined : state.replies[reply.id]
  )

  return useMemo(
    () => (reply && live ? withProgress(reply, live) : reply),
    [reply, live]
  )
}

const NO_BLOCKS: never[] = []

/** The Reply's Thinking blocks, while this window has been open. */
export function useThinking(replyId: string) {
  return useSelector(
    useReplyStore(),
    state => state.thinking[replyId] ?? NO_BLOCKS
  )
}
