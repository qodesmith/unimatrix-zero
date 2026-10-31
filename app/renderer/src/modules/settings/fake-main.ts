import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'

/** Main's side of the bridge for Settings tests, keeping each update it sent. */
export function fakeMain(saved: Partial<Settings> = {}) {
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved}
  const sent: Command[] = []

  const bridge: Bridge = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a test fake: it answers settings.update alone, with its Settings
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type !== 'settings.update') throw new Error('Not faked')

      Object.assign(settings, command.changes)

      return {ok: true, value: {...settings}}
    }) as Bridge['send'],
    subscribe: (listener: (event: AppEvent) => void) => {
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers: [],
        signIn: null,
        settings: {...settings},
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
}
