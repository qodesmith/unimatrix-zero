import type {Tree} from '@uz/contract/trees'

/** What the sidebar and the canvas call the Tree, before it has a title too. */
export function treeName(tree: Tree) {
  return tree.title ?? tree.firstLine ?? 'Untitled Tree'
}
