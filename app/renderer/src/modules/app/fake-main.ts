import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Layout} from '@uz/contract/layout'
import type {Model} from '@uz/contract/providers'
import type {Settings} from '@uz/contract/settings'
import type {Tree} from '@uz/contract/trees'
import type {Prompt, Reply, StreamingReply} from '@uz/contract/turns'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'

export const receivedAt = '2026-10-19T12:00:00.000Z'

export const account = {email: 'sam@example.com', plan: 'Max'}

const fakeModel: Model = {
  id: 'fake',
  name: 'Fake',
  isDefault: true,
  resolvesTo: null,
  needsAppUpdate: false,
}

export function savedTree(fields: Partial<Tree> = {}): Tree {
  return {
    id: crypto.randomUUID(),
    title: null,
    firstLine: null,
    createdAt: receivedAt,
    lastActiveAt: receivedAt,
    unseenFailure: false,
    ...fields,
  }
}

interface Saved {
  trees?: Tree[]
  prompts?: Prompt[]
  replies?: Reply[]
  streaming?: StreamingReply[]
  firstLaunch?: boolean
  settings?: Partial<Settings>
  layout?: Partial<Layout>
}

export type FakeMain = ReturnType<typeof fakeMain>

/** Main's side of the bridge for App tests, keeping each command it was sent. */
export function fakeMain(saved: Saved = {}) {
  const trees = [...(saved.trees ?? [])]
  const prompts = [...(saved.prompts ?? [])]
  const replies = [...(saved.replies ?? [])]
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved.settings}
  const layout: Layout = {...DEFAULT_LAYOUT, ...saved.layout}
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function change(index: number, tree: Tree) {
    trees[index] = tree
    publish({type: 'TREE_CHANGED', tree})

    return tree
  }

  function answer(command: Command): CommandOutcome<CommandType> {
    if ('provider' in command) return {ok: true, value: {}}

    if (command.type === 'app.ping') {
      return {ok: true, value: {nonce: command.nonce, receivedAt}}
    }

    if (command.type === 'tree.list') {
      return {ok: true, value: {trees: trees.toReversed()}}
    }

    if (command.type === 'image.load') {
      return {ok: true, value: {dataUrl: 'data:image/png;base64,'}}
    }

    if (command.type === 'settings.update') {
      Object.assign(settings, command.changes)
      publish({type: 'SETTINGS_CHANGED', settings: {...settings}})

      return {ok: true, value: {...settings}}
    }

    if (command.type === 'layout.update') {
      Object.assign(layout, command.changes)
      publish({type: 'LAYOUT_CHANGED', layout: {...layout}})

      return {ok: true, value: {...layout}}
    }

    if (command.type === 'tree.create') {
      const tree = savedTree()

      trees.push(tree)
      publish({type: 'TREE_CREATED', tree})

      return {ok: true, value: tree}
    }

    const index = trees.findIndex(tree => tree.id === command.treeId)
    const found = trees[index]

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    if (command.type === 'tree.open') {
      return {
        ok: true,
        value: found.unseenFailure
          ? change(index, {...found, unseenFailure: false})
          : found,
      }
    }

    if (command.type === 'tree.delete') {
      trees.splice(index, 1)
      publish({type: 'TREE_DELETED', treeId: found.id})

      return {ok: true, value: {}}
    }

    if (command.type === 'tree.turns') {
      const {treeId} = command

      return {
        ok: true,
        value: {
          prompts: prompts.filter(prompt => prompt.treeId === treeId),
          replies: replies.filter(reply => reply.treeId === treeId),
        },
      }
    }

    if (command.type === 'prompt.send') {
      const prompt = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        parentReplyId: command.parentReplyId,
        text: command.text,
        createdAt: receivedAt,
      }

      const reply: Reply = {
        id: crypto.randomUUID(),
        treeId: command.treeId,
        promptId: prompt.id,
        provider: command.model.provider,
        model: command.model.model,
        status: 'streaming',
        content: [],
        contextSize: null,
        contextWindow: null,
        failure: null,
        compacted: false,
        createdAt: receivedAt,
      }

      prompts.push(prompt)
      replies.push(reply)

      return {
        ok: true,
        value: {prompt, reply, removed: {promptIds: [], replyIds: []}},
      }
    }

    if (command.type === 'tree.rename') {
      return {ok: true, value: change(index, {...found, title: command.title})}
    }

    return {ok: false, error: {code: 'not-found', message: 'Gone'}}
  }

  const bridge: Bridge = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test fake: each answer matches its command by hand
    send: (async (command: Command) => {
      sent.push(command)

      return answer(command)
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: saved.streaming ?? [],
        providers: [
          saved.firstLaunch
            ? {provider: 'claude', status: 'not-connected', account: null}
            : {provider: 'claude', status: 'ready', account},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        models: {claude: [fakeModel], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: {...settings},
        layout: {...layout},
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent, trees, replies, layout, publish}
}
