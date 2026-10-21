import type {Trees} from '#modules/trees/main'
import type {Command, CommandResult, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

export interface HandlerDeps {
  now: () => Date
  trees: Trees
  publish: (event: AppEvent) => void
}

/** A handler's way of answering `not-found` rather than `handler-failed`. */
export class NotFoundError extends Error {
  override name = 'NotFoundError'
}

type Handler<T extends CommandType> = (
  command: Extract<Command, {type: T}>,
  deps: HandlerDeps
) => Promise<CommandResult<T>> | CommandResult<T>

type Handlers = {[T in CommandType]: Handler<T>}

function found(tree: Tree | null): Tree {
  if (!tree) throw new NotFoundError('That Tree no longer exists.')

  return tree
}

export const handlers: Handlers = {
  'app.ping': ({nonce}, {now}) => ({nonce, receivedAt: now().toISOString()}),

  'tree.create': (_command, {now, trees, publish}) => {
    const tree = trees.create(now())
    publish({type: 'TREE_CREATED', tree})

    return tree
  },

  'tree.list': (_command, {trees}) => ({trees: trees.list()}),

  'tree.open': ({treeId}, {trees}) => found(trees.get(treeId)),

  'tree.rename': ({treeId, title}, {trees, publish}) => {
    const tree = found(trees.rename(treeId, title))
    publish({type: 'TREE_RENAMED', tree})

    return tree
  },
}
