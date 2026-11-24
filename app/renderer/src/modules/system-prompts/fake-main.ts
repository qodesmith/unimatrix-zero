import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'
import type {SystemPromptEntry} from '@uz/contract/system-prompts'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {PRESETS} from '@uz/contract/system-prompts'

interface Saved {
  settings?: Partial<Settings>
  own?: SystemPromptEntry[]
}

export function ownEntry(fields: Partial<SystemPromptEntry> = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'Mine',
    text: 'Answer like a pirate.',
    preset: false,
    ...fields,
  }
}

export function fakeMain(saved: Saved = {}) {
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved.settings}
  const library = [...PRESETS, ...(saved.own ?? [])]
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function systemPrompts() {
    return {entries: library.map(entry => ({...entry}))}
  }

  function libraryChanged() {
    publish({type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: systemPrompts()})
  }

  function answer(command: Command): CommandOutcome<CommandType> {
    if (command.type === 'settings.update') {
      Object.assign(settings, command.changes)
      publish({type: 'SETTINGS_CHANGED', settings: {...settings}})

      return {ok: true, value: {...settings}}
    }

    if (command.type === 'system-prompt.create') {
      const {name, text} = command
      const entry = {id: crypto.randomUUID(), name, text, preset: false}

      library.push(entry)
      libraryChanged()

      return {ok: true, value: entry}
    }

    if (
      command.type !== 'system-prompt.update' &&
      command.type !== 'system-prompt.delete'
    ) {
      throw new Error('Not faked')
    }

    const index = library.findIndex(
      entry => entry.id === command.id && !entry.preset
    )

    if (index === -1) {
      return {ok: false, error: {code: 'not-found', message: 'Gone'}}
    }

    if (command.type === 'system-prompt.update') {
      const {id, name, text} = command
      const entry = {id, name, text, preset: false}

      library[index] = entry
      libraryChanged()

      return {ok: true, value: entry}
    }

    library.splice(index, 1)
    libraryChanged()

    if (settings.defaultSystemPromptId === command.id) {
      settings.defaultSystemPromptId = DEFAULT_SETTINGS.defaultSystemPromptId
      publish({type: 'SETTINGS_CHANGED', settings: {...settings}})
    }

    return {ok: true, value: {}}
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
        replies: [],
        providers: [],
        models: {claude: [], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: {...settings},
        systemPrompts: systemPrompts(),
        layout: DEFAULT_LAYOUT,
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
}
