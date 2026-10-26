import type {StopEvent} from './machine'

import {bridge} from '#modules/bridge/main'

interface AskToStop {
  treeId: string
  replyId: string
  send: (event: StopEvent) => void
}

/** Its `RUN_FINISHED` follows through the live events. */
export async function askToStop({treeId, replyId, send}: AskToStop) {
  const outcome = await bridge().send({type: 'reply.stop', treeId, replyId})

  if (!outcome.ok) send({type: 'refused', error: outcome.error.message})
}
