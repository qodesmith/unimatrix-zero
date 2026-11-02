import type {Tree} from '@uz/contract/trees'

export function treeName(tree: Tree) {
  return tree.title ?? tree.firstLine ?? 'Untitled Tree'
}
