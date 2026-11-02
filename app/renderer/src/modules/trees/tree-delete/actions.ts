import type {TreeDeleteEvent} from './machine'

import {bridge} from '#modules/bridge/main'

interface TreeDeleteInput {
  treeId: string
  send: (event: TreeDeleteEvent) => void
}

/** Main stops streaming Replies first; `TREE_DELETED` unmounts this machine. */
export async function deleteTree({treeId, send}: TreeDeleteInput) {
  const outcome = await bridge().send({type: 'tree.delete', treeId})

  if (!outcome.ok) send({type: 'refused', error: outcome.error.message})
}
