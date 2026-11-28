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
 * Streamed in this window, else saved. Takes null so a caller's hooks stay in
 * order.
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

export function useTreeStreaming(treeId: string) {
  return useSelector(useReplyStore(), state =>
    Object.values(state.replies).some(reply => reply.treeId === treeId)
  )
}

const NO_BLOCKS: never[] = []

export function useThinking(replyId: string) {
  return useSelector(
    useReplyStore(),
    state => state.thinking[replyId] ?? NO_BLOCKS
  )
}

export function useWaiting(replyId: string) {
  return useSelector(useReplyStore(), state => state.waiting[replyId])
}

const NO_APPROVALS: never[] = []

export function useApprovals(replyId: string) {
  return useSelector(
    useReplyStore(),
    state => state.approvals[replyId] ?? NO_APPROVALS
  )
}

export function useSubagentDescription(
  replyId: string,
  subagentId: string | null
) {
  return useSelector(useReplyStore(), state =>
    subagentId === null
      ? null
      : (state.subagents[replyId]?.[subagentId] ?? null)
  )
}

export function useAwaitingAnswer(replyId: string) {
  return useSelector(useReplyStore(), state =>
    (state.approvals[replyId] ?? []).some(
      item => item.kind === 'card' && item.answer === null
    )
  )
}
