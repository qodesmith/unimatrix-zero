import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'
import type {Tree} from '@uz/contract/trees'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {PRESETS} from '@uz/contract/system-prompts'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'

export function savedTree(fields: Partial<Tree> = {}): Tree {
  return {
    id: crypto.randomUUID(),
    title: null,
    firstLine: null,
    createdAt: '2026-10-19T12:00:00.000Z',
    lastActiveAt: '2026-10-19T12:00:00.000Z',
    unseenFailure: false,
    systemPrompt: {id: crypto.randomUUID(), text: ''},
    tools: DEFAULT_TREE_TOOLS,
    ...fields,
  }
}

interface FakeMainOptions {
  settings?: Partial<Settings>
  trees?: Tree[]
  refusesSettings?: boolean
}

export function fakeMain(options: FakeMainOptions = {}) {
  const settings: Settings = {...DEFAULT_SETTINGS, ...options.settings}
  const trees = options.trees ?? []
  const sent: Command[] = []

  function answer(command: Command): CommandOutcome<CommandType> {
    if (command.type === 'settings.update') {
      if (options.refusesSettings) {
        return {ok: false, error: {code: 'handler-failed', message: 'Refused'}}
      }

      Object.assign(settings, command.changes)

      return {ok: true, value: {...settings}}
    }

    if (command.type !== 'tree.set-tools') throw new Error('Not faked')

    const found = trees.find(tree => tree.id === command.treeId)

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    return {
      ok: true,
      value: {...found, tools: {...found.tools, ...command.changes}},
    }
  }

  const bridge: Bridge = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test fake: each answer matches its command by hand
    send: (async (command: Command) => {
      sent.push(command)

      return answer(command)
    }) as Bridge['send'],
    subscribe: (listener: (event: AppEvent) => void) => {
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        approvals: [],
        providers: [],
        models: {claude: [], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: {...settings},
        systemPrompts: {entries: [...PRESETS]},
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
}
