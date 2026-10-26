import type {Connections} from '#modules/connections/main'
import type {ProviderHosts} from '#modules/provider-hosts/main'
import type {RemoteImages} from '#modules/remote-images/main'
import type {SettingsStore} from '#modules/settings/main'
import type {Trees} from '#modules/trees/main'
import type {Turns} from '#modules/turns/main'
import type {Command, CommandResult, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {ReplyRequest, SignInRequest} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {Tree} from '@uz/contract/trees'
import type {Reply} from '@uz/contract/turns'

import {PROVIDER_NAMES} from '@uz/contract/providers'

export interface HandlerDeps {
  now: () => Date
  trees: Trees
  turns: Turns
  hosts: Pick<ProviderHosts, 'ready' | 'send'>
  connections: Pick<
    Connections,
    'connect' | 'openPage' | 'submitCode' | 'cancel'
  >
  /** The vendor program and configuration folder a Provider's Replies use. */
  vendorProgramFor: (provider: ProviderId) => SignInRequest
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

function startOnHost(
  {turns, hosts}: Pick<HandlerDeps, 'turns' | 'hosts'>,
  provider: ProviderId,
  request: ReplyRequest
): Reply | null {
  try {
    hosts.send(provider, {type: 'reply.start', request})

    return null
  } catch {
    return turns.fail(request.replyId, {
      code: 'host-unreachable',
      message: `${PROVIDER_NAMES[provider]} could not be reached.`,
    })
  }
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

  'prompt.send': (
    {treeId, parentReplyId, text},
    {now, trees, turns, hosts, vendorProgramFor}
  ) => {
    found(trees.get(treeId))

    const continued =
      parentReplyId === null ? null : turns.continuation(treeId, parentReplyId)

    if (parentReplyId !== null && !continued) {
      throw new NotFoundError('That Reply no longer exists.')
    }

    const ready = hosts.ready(continued?.provider)

    if (!ready) {
      throw new Error(
        continued
          ? `Connect ${PROVIDER_NAMES[continued.provider]} to continue this Thread.`
          : 'Connect a Provider to send a Prompt.'
      )
    }

    const {provider, model} = ready
    const systemPrompt = ''

    const sent = turns.start({
      treeId,
      parentReplyId,
      text,
      provider,
      model: model.id,
      systemPrompt,
      now: now(),
    })

    const failed = startOnHost({turns, hosts}, provider, {
      treeId,
      replyId: sent.reply.id,
      model: model.id,
      systemPrompt,
      prompt: {text},
      vendorProgram: vendorProgramFor(provider),
      session: continued?.session ?? null,
    })

    return failed ? {prompt: sent.prompt, reply: failed} : sent
  },

  'reply.stop': ({treeId, replyId}, {turns, hosts}) => {
    hosts.send(turns.writer(treeId, replyId), {type: 'reply.stop', replyId})

    return {}
  },

  'reply.retry': (
    {treeId, replyId},
    {trees, turns, hosts, vendorProgramFor}
  ) => {
    found(trees.get(treeId))

    const recovery = turns.recovery(treeId, replyId)

    if (!recovery) throw new NotFoundError('That Reply no longer exists.')

    const {provider, model, systemPrompt, text, session} = recovery

    if (!hosts.ready(provider)) {
      throw new Error(`Connect ${PROVIDER_NAMES[provider]} to retry.`)
    }

    const reply = turns.restart(replyId)

    const failed = startOnHost({turns, hosts}, provider, {
      treeId,
      replyId,
      model,
      systemPrompt,
      prompt: {text},
      vendorProgram: vendorProgramFor(provider),
      session,
    })

    return {reply: failed ?? reply}
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
