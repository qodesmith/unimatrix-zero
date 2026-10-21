import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome, CommandType} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Tree} from '@uz/contract/trees'

import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'

import {App} from './App'

const receivedAt = '2026-10-19T12:00:00.000Z'

/** Main as the window sees it: answers commands and sends what it saved. */
function fakeMain(saved: Tree[] = []): Bridge {
  const trees = [...saved]
  const listeners = new Set<(event: AppEvent) => void>()

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function answer(command: Command): CommandOutcome<CommandType> {
    if (command.type === 'app.ping') {
      return {ok: true, value: {nonce: command.nonce, receivedAt}}
    }

    if (command.type === 'tree.list') {
      return {ok: true, value: {trees: trees.toReversed()}}
    }

    if (command.type === 'tree.create') {
      const tree = {id: crypto.randomUUID(), title: null, createdAt: receivedAt}

      trees.push(tree)
      publish({type: 'TREE_CREATED', tree})

      return {ok: true, value: tree}
    }

    const index = trees.findIndex(tree => tree.id === command.treeId)
    const found = trees[index]

    if (!found) return {ok: false, error: {code: 'not-found', message: 'Gone'}}

    if (command.type === 'tree.open') return {ok: true, value: found}

    const tree = {...found, title: command.title}
    trees[index] = tree
    publish({type: 'TREE_RENAMED', tree})

    return {ok: true, value: tree}
  }

  return {
    send: (async (command: Command) => answer(command)) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({type: 'SNAPSHOT', app: {version: '0.0.0'}})

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }
}

it('shows the pong main sends back', async () => {
  globalThis.window.uz = fakeMain()
  await render(<App />)
  await page.getByRole('button', {name: 'Ping main'}).click()
  await expect
    .element(page.getByText(/pong · .* · 2026-10-19T12:00:00.000Z/))
    .toBeVisible()
})

it('lists the Trees main has saved', async () => {
  globalThis.window.uz = fakeMain([
    {id: crypto.randomUUID(), title: 'Trip planning', createdAt: receivedAt},
  ])
  await render(<App />)

  await expect
    .element(page.getByRole('button', {name: 'Trip planning'}))
    .toBeVisible()
})

it('creates a Tree and opens it', async () => {
  globalThis.window.uz = fakeMain()
  await render(<App />)
  await expect.element(page.getByText('Start a new Tree')).toBeVisible()

  await page.getByRole('button', {name: 'New Tree'}).click()

  await expect
    .element(page.getByRole('button', {name: 'Untitled Tree'}))
    .toHaveAttribute('aria-current', 'page')
  await expect
    .element(page.getByRole('heading', {name: 'Untitled Tree'}))
    .toBeVisible()
})

it('renames a Tree by double-clicking it', async () => {
  globalThis.window.uz = fakeMain([
    {id: crypto.randomUUID(), title: 'Draft', createdAt: receivedAt},
  ])
  await render(<App />)

  await page.getByRole('button', {name: 'Draft'}).dblClick()
  await page.getByRole('textbox', {name: 'Tree name'}).fill('Trip planning')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(page.getByRole('button', {name: 'Trip planning'}))
    .toBeVisible()
})

it('leaves the name alone when renaming is abandoned', async () => {
  globalThis.window.uz = fakeMain([
    {id: crypto.randomUUID(), title: 'Draft', createdAt: receivedAt},
  ])
  await render(<App />)

  await page.getByRole('button', {name: 'Draft'}).click()
  await userEvent.keyboard('{F2}')
  await page.getByRole('textbox', {name: 'Tree name'}).fill('Nope')
  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByRole('button', {name: 'Draft'})).toBeVisible()
})
