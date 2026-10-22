import type {ReplyStore} from './live-replies'

import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const ReplyStoreContext = createContext<ReplyStore | null>(null)

function useReplyStore() {
  const store = use(ReplyStoreContext)

  if (!store) throw new Error('useLiveReply needs <LiveReplies> above it')

  return store
}

/** The Reply as it streams, or undefined once it isn't streaming here. */
export function useLiveReply(replyId: string) {
  return useSelector(useReplyStore(), state => state.replies[replyId])
}

const NO_ROUNDS: never[] = []

/** What the Reply's Model thought, while this window has been open. */
export function useThinking(replyId: string) {
  return useSelector(
    useReplyStore(),
    state => state.thinking[replyId] ?? NO_ROUNDS
  )
}
