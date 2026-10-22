import type {ProviderHosts} from '#modules/provider-hosts/main'
import type {Trees} from '#modules/trees/main'
import type {Turns} from '#modules/turns/main'
import type {Command, CommandResult, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

import {PROVIDER_NAMES} from '@uz/contract/providers'

export interface HandlerDeps {
  now: () => Date
  trees: Trees
  turns: Turns
  hosts: Pick<ProviderHosts, 'ready' | 'send'>
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

  'prompt.send': ({treeId, text}, {now, trees, turns, hosts}) => {
    found(trees.get(treeId))
    const ready = hosts.ready()

    if (!ready) throw new Error('Connect a Provider to send a Prompt.')

    const {provider, model} = ready
    const systemPrompt = ''

    const sent = turns.startRoot({
      treeId,
      text,
      provider,
      model: model.id,
      systemPrompt,
      now: now(),
    })

    try {
      hosts.send(provider, {
        type: 'reply.start',
        request: {
          treeId,
          replyId: sent.reply.id,
          model: model.id,
          systemPrompt,
          prompt: {text},
        },
      })
    } catch {
      turns.apply(provider, {
        type: 'RUN_FINISHED',
        treeId,
        replyId: sent.reply.id,
        status: 'failed',
        failure: {
          code: 'host-unreachable',
          message: `${PROVIDER_NAMES[provider]} could not be reached.`,
        },
      })
    }

    return sent
  },
}
