import type {DeleteOutcome} from '#modules/turns/main'

import {bridge} from '#modules/bridge/main'

/** `TREE_DELETED` drops its row, which closes it if it's open. */
export async function deleteTree(treeId: string): Promise<DeleteOutcome> {
  const outcome = await bridge().send({type: 'tree.delete', treeId})

  return outcome.ok ? {ok: true} : {ok: false, error: outcome.error.message}
}
