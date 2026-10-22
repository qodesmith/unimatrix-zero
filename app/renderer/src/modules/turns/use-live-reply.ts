import type {ReplyStore} from './live-replies'

import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const ReplyStoreContext = createContext<ReplyStore | null>(null)

/** The Reply as it streams, or undefined once it isn't streaming here. */
export function useLiveReply(replyId: string) {
  const store = use(ReplyStoreContext)

  if (!store) throw new Error('useLiveReply needs <LiveReplies> above it')

  return useSelector(store, replies => replies[replyId])
}
