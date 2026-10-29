import type {Connections} from '#modules/connections/main'
import type {RemoteImages} from '#modules/remote-images/main'
import type {SettingsStore} from '#modules/settings/main'
import type {Trees} from '#modules/trees/main'
import type {Turns} from '#modules/turns/main'
import type {Command, CommandResult, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

export interface HandlerDeps {
  now: () => Date
  trees: Trees
  turns: Turns
  connections: Pick<
    Connections,
    'connect' | 'openPage' | 'submitCode' | 'cancel'
  >
  images: RemoteImages
  settings: SettingsStore
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

  'tree.turns': ({treeId}, {trees, turns}) => {
    found(trees.get(treeId))

    return turns.list(treeId)
  },

  'prompt.send': (command, {trees, turns}) => {
    found(trees.get(command.treeId))

    const sent = turns.sendPrompt(command)

    if (!sent) throw new NotFoundError('That Reply no longer exists.')

    return sent
  },

  'prompt.delete': ({treeId, promptId}, {trees, turns}) => {
    found(trees.get(treeId))

    const deleted = turns.deletePrompt(treeId, promptId)

    if (!deleted) throw new NotFoundError('That Prompt no longer exists.')

    return deleted
  },

  'reply.stop': ({treeId, replyId}, {turns}) => {
    turns.stop(treeId, replyId)

    return {}
  },

  'reply.retry': ({treeId, replyId}, {trees, turns}) => {
    found(trees.get(treeId))

    const reply = turns.retry(treeId, replyId)

    if (!reply) throw new NotFoundError('That Reply no longer exists.')

    return {reply}
  },

  'provider.connect': ({provider}, {connections}) => {
    connections.connect(provider)

    return {}
  },

  'sign-in.open-page': ({provider}, {connections}) => {
    connections.openPage(provider)

    return {}
  },

  'sign-in.code': ({provider, code}, {connections}) => {
    connections.submitCode(provider, code)

    return {}
  },

  'sign-in.cancel': ({provider}, {connections}) => {
    connections.cancel(provider)

    return {}
  },

  'image.load': async ({url}, {images}) => images.load(url),

  'settings.update': ({changes}, {settings, publish}) => {
    const saved = settings.update(changes)
    publish({type: 'SETTINGS_CHANGED', settings: saved})

    return saved
  },
}
