import type {Settings} from '@uz/contract/settings'

import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain} from '../fake-main'
import {SettingsPage} from './SettingsPage'
import {SettingsProvider} from './SettingsProvider'

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
  await renderSettings({
    themeMode: 'dark',
    canvasOrientation: 'horizontal',
    contextSizeMeter: false,
    limitTurnHeight: false,
  })

  await expect
    .element(page.getByRole('heading', {name: 'Appearance'}))
    .toBeVisible()
  await expect.element(page.getByRole('radio', {name: 'Dark'})).toBeChecked()
  await expect
    .element(page.getByRole('radio', {name: 'Horizontal'}))
    .toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Context size meter/}))
    .not.toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Limit height/}))
    .not.toBeChecked()
})

it('saves each Appearance Setting as it is changed, and shows the change', async () => {
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

it('shows the saved font size, saves it from the slider, and resets it to 16px', async () => {
  const main = await renderSettings({fontSize: 20})
  const slider = page.getByRole('slider', {name: 'Font size'})
  const reset = page.getByRole('button', {name: 'Reset'})

  await expect.element(slider).toHaveValue('20')
  await expect.element(page.getByText('20px')).toBeVisible()

  await slider.fill('14')
  await expect.element(page.getByText('14px')).toBeVisible()
  await reset.click()

  await expect.element(page.getByText('16px')).toBeVisible()
  await expect.element(reset).toBeDisabled()
  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {fontSize: 14}},
    {type: 'settings.update', changes: {fontSize: 16}},
  ])
})

it('shows and saves the send key and the re-read note from Chat', async () => {
  const main = await renderSettings({sendKey: 'mod-enter', reReadNote: false})

  await sections().getByRole('button', {name: 'Chat'}).click()
  await expect
    .element(
      page.getByRole('radio', {
        name: 'Enter adds a new line · ⌘/Ctrl+Enter sends',
      })
    )
    .toBeChecked()
  await expect
    .element(page.getByRole('checkbox', {name: /Re-read note/}))
    .not.toBeChecked()

  await page
    .getByRole('radio', {name: 'Enter sends · Shift+Enter adds a new line'})
    .click()
  await page.getByRole('checkbox', {name: /Re-read note/}).click()

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {sendKey: 'enter'}},
      {type: 'settings.update', changes: {reReadNote: true}},
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
