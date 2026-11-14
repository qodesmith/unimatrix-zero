import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import {
  applyLiveEvent,
  createReplyStore,
  markStreamingWaiting,
} from '../live-replies'
import {ReplyStoreContext} from '../use-live-reply'

/** Keeps the streaming Replies in step with main for everything inside it. */
export function LiveReplies({children}: {children: ReactNode}) {
  const queryClient = useQueryClient()
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createReplyStore)

  useEffect(
    () =>
      bridge().subscribe(event => applyLiveEvent(event, store, queryClient)),
    [store, queryClient]
  )

  useEffect(() => {
    function markWaiting() {
      markStreamingWaiting(store)
    }

    globalThis.addEventListener('online', markWaiting)

    return () => globalThis.removeEventListener('online', markWaiting)
  }, [store])

  return <ReplyStoreContext value={store}>{children}</ReplyStoreContext>
}
