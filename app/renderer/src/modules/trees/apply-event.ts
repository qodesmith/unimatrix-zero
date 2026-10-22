import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

function newestFirst(a: Tree, b: Tree) {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** Folds a live event into the Trees list; applying one twice changes nothing. */
export function applyEvent(trees: Tree[], event: AppEvent): Tree[] {
  if (event.type !== 'TREE_CREATED' && event.type !== 'TREE_RENAMED') {
    return trees
  }

  return [
    event.tree,
    ...trees.filter(tree => tree.id !== event.tree.id),
  ].toSorted(newestFirst)
}
