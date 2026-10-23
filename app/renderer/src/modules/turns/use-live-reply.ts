import type {ReplyStore} from './live-replies'

import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const ReplyStoreContext = createContext<ReplyStore | null>(null)

function useReplyStore() {
  const store = use(ReplyStoreContext)

  if (!store)
    throw new Error('The live Reply hooks need <LiveReplies> above them')

  return store
}

/** The Reply as it streams, or undefined once it isn't streaming here. */
export function useLiveReply(replyId: string) {
  return useSelector(useReplyStore(), state => state.replies[replyId])
}

const NO_BLOCKS: never[] = []

/** The Reply's Thinking blocks, while this window has been open. */
export function useThinking(replyId: string) {
  return useSelector(
    useReplyStore(),
    state => state.thinking[replyId] ?? NO_BLOCKS
  )
}
