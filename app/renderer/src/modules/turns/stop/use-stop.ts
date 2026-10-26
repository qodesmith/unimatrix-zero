import type {ReplyStore} from '../live-replies'
import type {StopEvent} from './machine'

import {useSelector} from '@tanstack/react-store'
import {useCallback} from 'react'

import {useReplyStore} from '../use-live-reply'
import {askToStop} from './actions'
import {initialStop, stopTransition} from './machine'

/** True when the event moved the Reply's Stop. */
function sendStop(store: ReplyStore, replyId: string, event: StopEvent) {
  const before = store.state.stops[replyId] ?? initialStop
  const after = stopTransition(before, event)

  if (after === before) return false

  store.setState(state => ({
    ...state,
    stops: {...state.stops, [replyId]: after},
  }))

  return true
}

/**
 * The Stop of the Reply streaming in `replyId`. Takes null so a caller's hooks
 * stay in order.
 */
export function useStop(treeId: string, replyId: string | null) {
  const store = useReplyStore()

  const state = useSelector(store, ({stops}) =>
    replyId === null ? initialStop : (stops[replyId] ?? initialStop)
  )

  const stop = useCallback(() => {
    if (replyId === null) return

    const stopping = replyId

    function send(event: StopEvent) {
      return sendStop(store, stopping, event)
    }

    if (send({type: 'asked'})) void askToStop({treeId, replyId, send})
  }, [store, treeId, replyId])

  return {state, stop}
}
