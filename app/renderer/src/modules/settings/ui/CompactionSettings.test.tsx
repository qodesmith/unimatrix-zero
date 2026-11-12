import type {ProviderId} from '@uz/contract/providers'
import type {Settings} from '@uz/contract/settings'

import {COMPACTION_THRESHOLD} from '@uz/contract/settings'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'

import {fakeMain} from '../fake-main'
import {CompactionSettings} from './CompactionSettings'
import {SettingsProvider} from './SettingsProvider'

async function renderCompaction(
  provider: ProviderId,
  saved: Partial<Settings> = {}
) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  await render(
    <SettingsProvider>
      <CompactionSettings provider={provider} />
    </SettingsProvider>
  )

  return main
}

function autoCompaction() {
  return page.getByRole('switch', {name: /Automatic Compaction/})
}

function threshold() {
  return page.getByRole('textbox', {name: 'Compact at'})
}

function slider() {
  return page.getByRole('slider', {name: 'Compact at'})
}

it('has Claude compact automatically by default, and saves turning it off, which disables the threshold', async () => {
  const main = await renderCompaction('claude')

  await expect.element(autoCompaction()).toBeChecked()
  await expect.element(threshold()).toBeEnabled()
  await autoCompaction().click()

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {claudeAutoCompaction: false}},
    ])
  await expect.element(autoCompaction()).not.toBeChecked()
  await expect.element(slider()).toBeDisabled()
  await expect.element(threshold()).toBeDisabled()
})

it('shows ChatGPT compacting automatically, with no way to turn it off', async () => {
  await renderCompaction('chatgpt', {claudeAutoCompaction: false})

  await expect.element(autoCompaction()).toBeChecked()
  await expect.element(autoCompaction()).toBeDisabled()
  await expect.element(threshold()).toBeEnabled()
  await expect
    .element(page.getByText('Codex can’t turn Compaction off.'))
    .toBeVisible()
})

it('saves an exact threshold typed in, on Enter', async () => {
  const main = await renderCompaction('claude')
  const input = threshold()

  await input.fill('456789')
  await userEvent.keyboard('{Enter}')

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {claudeCompactionThreshold: 456_789}},
    ])
  await expect.element(input).toHaveValue('456,789')
  await expect.element(slider()).toHaveAttribute('aria-valuenow', '456789')
})

it('shows the slider’s maximum as Default, and saves moving there as unset', async () => {
  const main = await renderCompaction('claude', {
    claudeCompactionThreshold: 500_000,
  })

  await expect.element(threshold()).toHaveValue('500,000')

  slider().element().focus()
  await userEvent.keyboard('{End}')

  await expect
    .poll(() => main.sent)
    .toEqual([
      {type: 'settings.update', changes: {claudeCompactionThreshold: null}},
    ])
  await expect.element(threshold()).toHaveValue('Default')
})

it('clamps a typed threshold to the Provider’s range, the top of it saving as unset', async () => {
  const {min} = COMPACTION_THRESHOLD.chatgpt
  const main = await renderCompaction('chatgpt')

  await threshold().fill('5')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(threshold())
    .toHaveValue(new Intl.NumberFormat('en-US').format(min))

  await threshold().fill('99,999,999')
  await userEvent.keyboard('{Enter}')
  await expect.element(threshold()).toHaveValue('Default')

  expect(main.sent).toEqual([
    {type: 'settings.update', changes: {chatgptCompactionThreshold: min}},
    {type: 'settings.update', changes: {chatgptCompactionThreshold: null}},
  ])
})

it('puts back the saved threshold when the input is left empty', async () => {
  const main = await renderCompaction('claude', {
    claudeCompactionThreshold: 300_000,
  })

  await threshold().fill('')
  await userEvent.tab()

  await expect.element(threshold()).toHaveValue('300,000')
  expect(main.sent).toEqual([])
})
