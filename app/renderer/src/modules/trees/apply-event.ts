import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

function lastActiveFirst(a: Tree, b: Tree) {
  return (
    b.lastActiveAt.localeCompare(a.lastActiveAt) || b.id.localeCompare(a.id)
  )
}

/** The order the sidebar lists Trees in. */
export function sortTrees(trees: Tree[]) {
  return trees.toSorted(lastActiveFirst)
}

/** Folds a live event into the Trees list; applying one twice changes nothing. */
export function applyEvent(trees: Tree[], event: AppEvent): Tree[] {
  if (event.type === 'TREE_DELETED') {
    return trees.filter(tree => tree.id !== event.treeId)
  }

  if (event.type !== 'TREE_CREATED' && event.type !== 'TREE_CHANGED') {
    return trees
  }

  return sortTrees([
    event.tree,
    ...trees.filter(tree => tree.id !== event.tree.id),
  ])
}
