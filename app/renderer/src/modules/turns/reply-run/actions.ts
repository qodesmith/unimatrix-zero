import type {ReplyRunEvent} from './machine'
import type {QueryClient} from '@tanstack/react-query'

import {bridge} from '#modules/bridge/main'

import {updateSavedReply} from '../saved-turns'

interface ReplyRunInput {
  treeId: string
  replyId: string
  send: (event: ReplyRunEvent) => void
}

/** Its `RUN_FINISHED` follows through the live events. */
export async function askToStop({treeId, replyId, send}: ReplyRunInput) {
  const outcome = await bridge().send({type: 'reply.stop', treeId, replyId})

  if (!outcome.ok) send({type: 'stopRefused', error: outcome.error.message})
}

/**
 * Main hands back the same Reply id, streaming from nothing, which takes the
 * old one's place in the saved Turns.
 */
export async function askToRetry({
  treeId,
  replyId,
  send,
  queryClient,
}: ReplyRunInput & {queryClient: QueryClient}) {
  const outcome = await bridge().send({type: 'reply.retry', treeId, replyId})

  if (!outcome.ok) {
    send({type: 'retryRefused', error: outcome.error.message})

    return
  }

  updateSavedReply(queryClient, {treeId, replyId}, () => outcome.value.reply)
  send({type: 'retryAccepted'})
}
