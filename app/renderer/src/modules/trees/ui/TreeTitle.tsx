import type {Tree} from '@uz/contract/trees'

import {treeName} from '../tree-name'

export function TreeTitle({tree}: {tree: Tree}) {
  return tree.title ?? <span className="italic">{treeName(tree)}</span>
}
