import type {TreeDeleteEvent} from './machine'
import type {CommandOutcome} from '@uz/contract/commands'

interface TreeDeleteInput {
  runDelete: () => Promise<CommandOutcome<'tree.delete'>>
  send: (event: TreeDeleteEvent) => void
}

/** Main stops streaming Replies first; `TREE_DELETED` unmounts this machine. */
export async function deleteTree({runDelete, send}: TreeDeleteInput) {
  const outcome = await runDelete()

  if (!outcome.ok) send({type: 'refused', error: outcome.error.message})
}
