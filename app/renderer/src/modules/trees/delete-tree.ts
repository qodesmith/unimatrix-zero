import {bridge} from '#modules/bridge/main'

/** `TREE_DELETED` drops its row, which closes it if it's open. */
export async function deleteTree(
  treeId: string
): Promise<{ok: true} | {ok: false; error: string}> {
  const outcome = await bridge().send({type: 'tree.delete', treeId})

  return outcome.ok ? {ok: true} : {ok: false, error: outcome.error.message}
}
