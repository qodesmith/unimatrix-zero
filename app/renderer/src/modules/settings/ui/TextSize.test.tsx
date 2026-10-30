import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'

import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {afterEach, expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {userEvent} from 'vitest/browser'

import {SettingsProvider} from './SettingsProvider'
import {TextSize} from './TextSize'

function fakeMain(saved: Partial<Settings>) {
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved}
  const sent: Command[] = []

  const bridge: Bridge = {
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
      })

      return () => {}
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
}

async function renderTextSize(saved: Partial<Settings>) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  await render(
    <SettingsProvider>
      <TextSize />
    </SettingsProvider>
  )

  return main
}

function rootFontSize() {
  return document.documentElement.style.fontSize
}

afterEach(() => {
  document.documentElement.style.fontSize = ''
})

it('sizes the root font from the saved text size', async () => {
  await renderTextSize({textSize: 20})

  await expect.poll(rootFontSize).toBe('20px')
})

it('saves and shows a bigger text size on ⌘+, and a smaller one on ⌘−', async () => {
  const main = await renderTextSize({textSize: 20})
  await expect.poll(rootFontSize).toBe('20px')

  await userEvent.keyboard('{Meta>}={/Meta}')

  await expect.poll(rootFontSize).toBe('22px')

  await userEvent.keyboard('{Meta>}-{/Meta}{Meta>}-{/Meta}')

  await expect.poll(rootFontSize).toBe('18px')
  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {textSize: 22}},
    {type: 'settings.update', changes: {textSize: 20}},
    {type: 'settings.update', changes: {textSize: 18}},
  ])
})

it('steps twice for two presses that come before a render', async () => {
  const main = await renderTextSize({textSize: 20})
  await expect.poll(rootFontSize).toBe('20px')

  for (let i = 0; i < 2; i++) {
    globalThis.dispatchEvent(
      new KeyboardEvent('keydown', {key: '=', metaKey: true})
    )
  }

  await expect.poll(rootFontSize).toBe('24px')
  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {textSize: 22}},
    {type: 'settings.update', changes: {textSize: 24}},
  ])
})
