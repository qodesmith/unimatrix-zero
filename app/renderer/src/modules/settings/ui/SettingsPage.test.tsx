import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'

import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {SettingsPage} from './SettingsPage'
import {SettingsProvider} from './SettingsProvider'

function fakeMain(saved: Partial<Settings> = {}) {
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

async function renderSettings(saved: Partial<Settings> = {}) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  await render(
    <SettingsProvider>
      <SettingsPage connections={<p>The Provider cards</p>} />
    </SettingsProvider>
  )

  return main
}

function sections() {
  return page.getByRole('navigation', {name: 'Settings sections'})
}

it('lists every section, with those not built yet unavailable', async () => {
  await renderSettings()

  const names = sections()
    .getByRole('button')
    .elements()
    .map(button => [button.textContent, button.hasAttribute('disabled')])

  expect(names).toEqual([
    ['Appearance', false],
    ['Chat', false],
    ['System prompts', true],
    ['Tools', true],
    ['Connections', false],
    ['Storage', true],
    ['Archive & restore', true],
    ['Updates & About', true],
  ])
})

it('opens on Appearance, showing the saved values', async () => {
  await renderSettings({themeMode: 'dark', limitTurnHeight: false})

  await expect
    .element(page.getByRole('heading', {name: 'Appearance'}))
    .toBeVisible()
  await expect.element(page.getByRole('radio', {name: 'Dark'})).toBeChecked()
  await expect
    .element(page.getByRole('radio', {name: 'Vertical'}))
    .toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Context size meter/}))
    .toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Limit height/}))
    .not.toBeChecked()
})

it('saves each Appearance Setting as it is changed', async () => {
  const main = await renderSettings()

  await page.getByRole('radio', {name: 'Light'}).click()
  await page.getByRole('radio', {name: 'Horizontal'}).click()
  await page.getByRole('checkbox', {name: /Context size meter/}).click()
  await page.getByRole('checkbox', {name: /Limit height/}).click()

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {themeMode: 'light'}},
      {type: 'settings.update', changes: {canvasOrientation: 'horizontal'}},
      {type: 'settings.update', changes: {contextSizeMeter: false}},
      {type: 'settings.update', changes: {limitTurnHeight: false}},
    ])
  await expect.element(page.getByRole('radio', {name: 'Light'})).toBeChecked()
})

it('saves the send key and the re-read note from Chat', async () => {
  const main = await renderSettings()

  await sections().getByRole('button', {name: 'Chat'}).click()
  await expect
    .element(
      page.getByRole('radio', {
        name: 'Enter sends · Shift+Enter adds a new line',
      })
    )
    .toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Re-read note/}))
    .toBeChecked()

  await page
    .getByRole('radio', {name: 'Enter adds a new line · ⌘/Ctrl+Enter sends'})
    .click()
  await page.getByRole('checkbox', {name: /Re-read note/}).click()

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {sendKey: 'mod-enter'}},
      {type: 'settings.update', changes: {reReadNote: false}},
    ])
})

it('shows the Provider cards under Connections', async () => {
  await renderSettings()

  await sections().getByRole('button', {name: 'Connections'}).click()

  await expect
    .element(
      page
        .getByRole('region', {name: 'Connections'})
        .getByText('The Provider cards')
    )
    .toBeVisible()
})
