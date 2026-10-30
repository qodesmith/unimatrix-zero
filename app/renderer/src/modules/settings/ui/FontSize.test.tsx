import type {Settings} from '@uz/contract/settings'

import {afterEach, expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {userEvent} from 'vitest/browser'

import {fakeMain} from '../fake-main'
import {FontSize} from './FontSize'
import {SettingsProvider} from './SettingsProvider'

async function renderFontSize(saved: Partial<Settings>) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  await render(
    <SettingsProvider>
      <FontSize />
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

it('sizes the root font from the saved font size', async () => {
  await renderFontSize({fontSize: 20})

  await expect.poll(rootFontSize).toBe('20px')
})

it('saves and shows a bigger font size on ⌘+, and a smaller one on ⌘−', async () => {
  const main = await renderFontSize({fontSize: 20})
  await expect.poll(rootFontSize).toBe('20px')

  await userEvent.keyboard('{Meta>}={/Meta}')

  await expect.poll(rootFontSize).toBe('22px')

  await userEvent.keyboard('{Meta>}-{/Meta}{Meta>}-{/Meta}')

  await expect.poll(rootFontSize).toBe('18px')
  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {fontSize: 22}},
    {type: 'settings.update', changes: {fontSize: 20}},
    {type: 'settings.update', changes: {fontSize: 18}},
  ])
})

it('steps twice for two presses that come before a render', async () => {
  const main = await renderFontSize({fontSize: 20})
  await expect.poll(rootFontSize).toBe('20px')

  for (let i = 0; i < 2; i++) {
    globalThis.dispatchEvent(
      new KeyboardEvent('keydown', {key: '=', metaKey: true})
    )
  }

  await expect.poll(rootFontSize).toBe('24px')
  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {fontSize: 22}},
    {type: 'settings.update', changes: {fontSize: 24}},
  ])
})
