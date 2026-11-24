import type {Settings} from '@uz/contract/settings'
import type {SystemPromptEntry} from '@uz/contract/system-prompts'

import {SettingsProvider} from '#modules/settings/main'
import {PRESETS, defaultEntry} from '@uz/contract/system-prompts'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain, ownEntry} from '../fake-main'
import {SystemPromptsProvider} from './SystemPromptsProvider'
import {SystemPromptsSection} from './SystemPromptsSection'

interface Saved {
  settings?: Partial<Settings>
  own?: SystemPromptEntry[]
}

async function renderSection(saved: Saved = {}) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  await render(
    <SettingsProvider>
      <SystemPromptsProvider>
        <SystemPromptsSection />
      </SystemPromptsProvider>
    </SettingsProvider>
  )

  return main
}

function defaultPicker() {
  return page.getByRole('combobox', {name: 'Default for new Trees'})
}

async function expectDefault(name: string) {
  await expect
    .element(defaultPicker().getByText(name, {exact: true}))
    .toBeVisible()
}

it('shows the default for new Trees, and saves another picked from the library', async () => {
  const main = await renderSection({
    settings: {defaultSystemPromptId: 'concise'},
  })

  await expectDefault('Concise')

  await defaultPicker().click()
  await page.getByRole('option', {name: 'Explain simply'}).click()

  await expectDefault('Explain simply')
  expect(main.sent).toEqual([
    {
      type: 'settings.update',
      changes: {defaultSystemPromptId: 'explain-simply'},
    },
  ])
})

function entry(name: string) {
  return page.getByRole('region', {name})
}

it('shows each preset read-only, and Duplicate makes an editable copy of it', async () => {
  const main = await renderSection()
  const concise = defaultEntry(PRESETS, 'concise')

  await expect.element(entry('Concise').getByText(concise.text)).toBeVisible()
  expect(entry('Concise').getByRole('textbox').query()).toBeNull()
  expect(
    entry('Concise').getByRole('button', {name: 'Delete…'}).query()
  ).toBeNull()

  await entry('Concise').getByRole('button', {name: 'Duplicate'}).click()

  const copy = entry('Copy of Concise')
  await expect
    .element(copy.getByRole('textbox', {name: 'Name'}))
    .toHaveValue('Copy of Concise')
  await expect
    .element(copy.getByRole('textbox', {name: 'Text'}))
    .toHaveValue(concise.text)
  expect(main.sent).toEqual([
    {type: 'system-prompt.create', name: 'Copy of Concise', text: concise.text},
  ])
})

it('saves an edit to one of the user’s own, with Save held until something changed', async () => {
  const mine = ownEntry()
  const main = await renderSection({own: [mine]})
  const save = entry('Mine').getByRole('button', {name: 'Save'})

  await expect.element(save).toBeDisabled()

  await entry('Mine').getByRole('textbox', {name: 'Name'}).fill('Pirate ')
  await entry('Mine')
    .getByRole('textbox', {name: 'Text'})
    .fill('Answer like a pirate, briefly.')
  await save.click()

  await expect
    .element(entry('Pirate').getByRole('button', {name: 'Save'}))
    .toBeDisabled()
  expect(main.sent).toEqual([
    {
      type: 'system-prompt.update',
      id: mine.id,
      name: 'Pirate',
      text: 'Answer like a pirate, briefly.',
    },
  ])
})

function deleteDialog() {
  return page.getByRole('alertdialog')
}

it('deletes one of the user’s own after asking, Cancel keeping it, and New Trees then start with Default', async () => {
  const mine = ownEntry()

  const main = await renderSection({
    own: [mine],
    settings: {defaultSystemPromptId: mine.id},
  })

  await expectDefault('Mine')

  await entry('Mine').getByRole('button', {name: 'Delete…'}).click()
  await expect
    .element(deleteDialog().getByRole('heading'))
    .toHaveTextContent('Delete System prompt?')
  await expect
    .element(
      deleteDialog().getByText(
        '“Mine” leaves the library. Trees that use it keep their own copy. New Trees will start with Default.'
      )
    )
    .toBeVisible()
  await deleteDialog().getByRole('button', {name: 'Cancel'}).click()
  await expect.element(deleteDialog()).not.toBeInTheDocument()
  expect(main.sent).toEqual([])

  await entry('Mine').getByRole('button', {name: 'Delete…'}).click()
  await deleteDialog().getByRole('button', {name: 'Delete'}).click()

  await expect.element(entry('Mine')).not.toBeInTheDocument()
  await expectDefault('Default')
  expect(main.sent).toEqual([{type: 'system-prompt.delete', id: mine.id}])
})
