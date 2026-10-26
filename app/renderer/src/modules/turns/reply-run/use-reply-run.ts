import type {ReplyStore} from '../live-replies'
import type {ReplyRunEvent} from './machine'

import {useQueryClient} from '@tanstack/react-query'
import {useSelector} from '@tanstack/react-store'
import {useCallback} from 'react'

import {withRun} from '../live-replies'
import {useReplyStore} from '../use-live-reply'
import {askToRetry, askToStop} from './actions'
import {initialReplyRun, replyRunTransition} from './machine'

/** True when the event moved the Reply's run. */
function sendRun(store: ReplyStore, replyId: string, event: ReplyRunEvent) {
  const before = store.state.runs[replyId] ?? initialReplyRun
  const after = replyRunTransition(before, event)

  if (after === before) return false

  store.setState(state => ({
    ...state,
    runs: withRun(state.runs, replyId, after),
  }))

  return true
}

/**
 * Stop and Retry for one Reply. Takes null so a caller's hooks stay in
 * order.
 */
export function useReplyRun(treeId: string, replyId: string | null) {
  const store = useReplyStore()
  const queryClient = useQueryClient()

  const state = useSelector(store, ({runs}) =>
    replyId === null ? initialReplyRun : (runs[replyId] ?? initialReplyRun)
  )

  const ask = useCallback(
    (asked: ReplyRunEvent, effect: typeof askToStop | typeof askToRetry) => {
      if (replyId === null) return

      const id = replyId

      function send(event: ReplyRunEvent) {
        return sendRun(store, id, event)
      }

      if (send(asked)) void effect({treeId, replyId: id, send, queryClient})
    },
    [store, queryClient, treeId, replyId]
  )

  const stop = useCallback(() => ask({type: 'stopAsked'}, askToStop), [ask])
  const retry = useCallback(() => ask({type: 'retryAsked'}, askToRetry), [ask])

  return {state, stop, retry}
}
