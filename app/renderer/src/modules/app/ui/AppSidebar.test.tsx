/// <reference types="@vitest/browser-playwright" />
import type {FakeMain, FakeSnapshot} from '../fake-main'
import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {Tree} from '@uz/contract/trees'
import type {ChangedFile, Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {SYSTEM_PROMPT_MAX_LENGTH} from '@uz/contract/system-prompts'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {render} from 'vitest-browser-react'
import {cdp, page, userEvent} from 'vitest/browser'

import {fakeMain, receivedAt, savedTree, treeFile} from '../fake-main'
import {App} from './App'

const MINUTE = 60_000

const NOW = Date.parse('2026-11-01T12:00:00.000Z')

function minutesAgo(minutes: number) {
  return new Date(NOW - minutes * MINUTE).toISOString()
}

afterEach(() => {
  vi.useRealTimers()
})

function FullHeight({children}: {children: ReactNode}) {
  return <div style={{height: '100vh'}}>{children}</div>
}

async function renderApp(main: FakeMain) {
  globalThis.window.uz = main

  return render(<App />, {wrapper: FullHeight})
}

function sidebar() {
  return page.getByRole('complementary')
}

function treeRow(name: string) {
  return sidebar().getByRole('button', {name})
}

function fontStyle(text: string) {
  return getComputedStyle(page.getByText(text).element()).fontStyle
}

function sentOf(main: FakeMain, type: string) {
  return main.sent.filter(command => command.type === type)
}

describe('a Tree’s row', () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ['Date']})
    vi.setSystemTime(NOW)
  })

  it('shows the root Prompt’s first line in italics until the automatic title replaces it', async () => {
    const tree = savedTree({firstLine: 'Plan a week in Lisbon'})
    const main = fakeMain({trees: [tree]})
    await renderApp(main)

    await expect.element(treeRow('Plan a week in Lisbon')).toBeVisible()
    expect(fontStyle('Plan a week in Lisbon')).toBe('italic')

    const titled: Tree = {...tree, title: 'Lisbon week'}
    main.publish({type: 'TREE_CHANGED', tree: titled})

    await expect.element(treeRow('Lisbon week')).toBeVisible()
    expect(fontStyle('Lisbon week')).toBe('normal')
    await expect
      .element(page.getByText('Plan a week in Lisbon'))
      .not.toBeInTheDocument()
  })

  it('lists the Trees last active first, each with how long ago that was', async () => {
    await renderApp(
      fakeMain({
        trees: [
          savedTree({title: 'Hours', lastActiveAt: minutesAgo(3 * 60)}),
          savedTree({title: 'Minutes', lastActiveAt: minutesAgo(5)}),
          savedTree({title: 'Days', lastActiveAt: minutesAgo(2 * 24 * 60)}),
        ],
      })
    )

    await expect.element(treeRow('Minutes')).toHaveAccessibleDescription('5m')
    await expect.element(treeRow('Hours')).toHaveAccessibleDescription('3h')
    await expect.element(treeRow('Days')).toHaveAccessibleDescription('2d')
    expect(
      page
        .getByRole('region', {name: 'Trees'})
        .getByRole('listitem')
        .elements()
        .map(row => row.querySelector('[data-slot="tree-title"]')?.textContent)
    ).toEqual(['Minutes', 'Hours', 'Days'])
  })

  it('shows a Reply streaming in a Tree that isn’t open, until it finishes', async () => {
    const writing = savedTree({title: 'Writing', lastActiveAt: minutesAgo(0)})
    const quiet = savedTree({title: 'Quiet', lastActiveAt: minutesAgo(0)})
    const main = fakeMain({trees: [writing, quiet]})
    await renderApp(main)
    await expect.element(treeRow('Writing')).toHaveAccessibleDescription('now')

    const ids = {treeId: writing.id, replyId: crypto.randomUUID()}
    main.publish({...ids, type: 'TEXT_DELTA', delta: 'Hi'})

    await expect
      .element(treeRow('Writing'))
      .toHaveAccessibleDescription('now Writing a Reply')
    await expect.element(treeRow('Quiet')).toHaveAccessibleDescription('now')

    main.publish({...ids, type: 'RUN_FINISHED', status: 'complete'})
    await expect.element(treeRow('Writing')).toHaveAccessibleDescription('now')
  })

  it('marks a failure the user hasn’t seen, until they open its Tree', async () => {
    const failed = savedTree({
      title: 'Failed',
      lastActiveAt: minutesAgo(0),
      unseenFailure: true,
    })

    const main = fakeMain({trees: [failed]})
    await renderApp(main)
    await expect
      .element(treeRow('Failed'))
      .toHaveAccessibleDescription('now A Reply failed')

    await treeRow('Failed').click()

    await expect.element(treeRow('Failed')).toHaveAccessibleDescription('now')
  })

  it('sees a failure in the open Tree as soon as it comes', async () => {
    const tree = savedTree({title: 'Open', lastActiveAt: minutesAgo(0)})
    const main = fakeMain({trees: [tree]})
    await renderApp(main)
    await treeRow('Open').click()
    await expect
      .element(page.getByRole('heading', {name: 'Open'}))
      .toBeVisible()
    expect(sentOf(main, 'tree.open')).toHaveLength(1)

    const failed = {...tree, unseenFailure: true}
    main.trees[0] = failed
    main.publish({type: 'TREE_CHANGED', tree: failed})

    await expect.poll(() => sentOf(main, 'tree.open')).toHaveLength(2)
    await expect.element(treeRow('Open')).toHaveAccessibleDescription('now')
  })
})

describe('renaming a Tree', () => {
  it('starts an untitled Tree from its first line, which Enter leaves untitled', async () => {
    const main = fakeMain({
      trees: [savedTree({firstLine: 'Plan a week in Lisbon'})],
    })

    await renderApp(main)

    await treeRow('Plan a week in Lisbon').click()
    await userEvent.keyboard('{F2}')
    await expect
      .element(page.getByRole('textbox', {name: 'Tree name'}))
      .toHaveValue('Plan a week in Lisbon')
    await userEvent.keyboard('{Enter}')

    await expect.element(treeRow('Plan a week in Lisbon')).toBeVisible()
    expect(sentOf(main, 'tree.rename')).toEqual([])
  })

  it('renames it by double-clicking it', async () => {
    await renderApp(fakeMain({trees: [savedTree({title: 'Draft'})]}))

    await treeRow('Draft').dblClick()
    await page.getByRole('textbox', {name: 'Tree name'}).fill('Trip planning')
    await userEvent.keyboard('{Enter}')

    await expect.element(treeRow('Trip planning')).toBeVisible()
  })

  it('leaves the name alone when renaming is abandoned', async () => {
    const main = fakeMain({trees: [savedTree({title: 'Draft'})]})
    await renderApp(main)

    await treeRow('Draft').click()
    await userEvent.keyboard('{F2}')
    await page.getByRole('textbox', {name: 'Tree name'}).fill('Nope')
    await userEvent.keyboard('{Escape}')

    await expect.element(treeRow('Draft')).toBeVisible()
    expect(sentOf(main, 'tree.rename')).toEqual([])
  })

  it('renames it from its ⋯ menu, which holds Rename, Tree panel and Delete…', async () => {
    await renderApp(
      fakeMain({
        trees: [savedTree({title: 'Draft'}), savedTree({title: 'Other'})],
      })
    )
    await sidebar().getByRole('button', {name: 'Actions for Other'}).click()
    await expect.element(page.getByRole('menu')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument()

    await sidebar().getByRole('button', {name: 'Actions for Draft'}).click()
    const menu = page.getByRole('menu')
    await expect.element(menu).toBeVisible()
    expect(
      menu
        .getByRole('menuitem')
        .elements()
        .map(item => item.textContent)
    ).toEqual(['Rename', 'Tree panel', 'Delete…'])

    await menu.getByRole('menuitem', {name: 'Rename'}).click()
    await expect.element(menu).not.toBeInTheDocument()

    const input = page.getByRole('textbox', {name: 'Tree name'})
    await expect.element(input).toHaveFocus()
    await userEvent.keyboard('Trip planning{Enter}')

    await expect.element(treeRow('Trip planning')).toBeVisible()
  })
})

const TRIP_PROMPT = 'Plan trips on a small budget.'

async function openTreePanel(name: string) {
  await sidebar()
    .getByRole('button', {name: `Actions for ${name}`})
    .click()
  await page.getByRole('menuitem', {name: 'Tree panel'}).click()

  const panel = page.getByRole('dialog', {name: 'Tree panel'})
  await expect.element(panel).toBeVisible()

  return panel
}

describe('a Tree’s panel', () => {
  it('opens from its ⋯ menu with its own System prompt, and saves an edit from its next Reply', async () => {
    const tree = savedTree({
      title: 'Trip',
      systemPrompt: {id: crypto.randomUUID(), text: TRIP_PROMPT},
    })

    const main = fakeMain({trees: [tree, savedTree({title: 'Other'})]})
    await renderApp(main)

    const panel = await openTreePanel('Trip')
    const text = panel.getByRole('textbox', {name: 'System prompt'})
    const save = panel.getByRole('button', {name: 'Save', exact: true})

    await expect.element(panel.getByText('Trip', {exact: true})).toBeVisible()
    await expect.element(text).toHaveValue(TRIP_PROMPT)
    await expect
      .element(
        panel
          .getByRole('region', {name: 'System prompt'})
          .getByText('Applies from this Tree’s next Reply.')
      )
      .toBeVisible()
    await expect.element(save).toBeDisabled()

    await text.fill('Plan trips by train.')
    await save.click()

    await expect.element(save).toBeDisabled()
    expect(sentOf(main, 'tree.set-system-prompt')).toEqual([
      {
        type: 'tree.set-system-prompt',
        treeId: tree.id,
        text: 'Plan trips by train.',
      },
    ])
  })

  it('saves the System prompt it shows to the library under a name asked for', async () => {
    const tree = savedTree({
      title: 'Trip',
      systemPrompt: {id: crypto.randomUUID(), text: TRIP_PROMPT},
    })

    const main = fakeMain({trees: [tree]})
    await renderApp(main)

    const panel = await openTreePanel('Trip')
    await panel
      .getByRole('textbox', {name: 'System prompt'})
      .fill('Plan trips by train.')
    await panel.getByRole('button', {name: 'Save to library…'}).click()

    const naming = page.getByRole('dialog', {name: 'Save to library'})
    const save = naming.getByRole('button', {name: 'Save'})
    await expect.element(save).toBeDisabled()

    await naming.getByRole('textbox', {name: 'Name'}).fill('  Train trips ')
    await save.click()

    await expect.element(naming).not.toBeInTheDocument()
    await expect.element(panel).toBeVisible()
    expect(sentOf(main, 'system-prompt.create')).toEqual([
      {
        type: 'system-prompt.create',
        name: 'Train trips',
        text: 'Plan trips by train.',
      },
    ])
    expect(sentOf(main, 'tree.set-system-prompt')).toEqual([])
  })

  it('says how far a System prompt runs over the limit, and holds Save and Save to library… until it fits', async () => {
    const tree = savedTree({
      title: 'Trip',
      systemPrompt: {id: crypto.randomUUID(), text: TRIP_PROMPT},
    })

    await renderApp(fakeMain({trees: [tree]}))

    const panel = await openTreePanel('Trip')
    const text = panel.getByRole('textbox', {name: 'System prompt'})
    const save = panel.getByRole('button', {name: 'Save', exact: true})
    const toLibrary = panel.getByRole('button', {name: 'Save to library…'})

    await text.fill('x'.repeat(SYSTEM_PROMPT_MAX_LENGTH + 1))

    await expect
      .element(panel.getByRole('status').getByText(/This one is 1 over\./))
      .toBeVisible()
    await expect.element(save).toBeDisabled()
    await expect.element(toLibrary).toBeDisabled()

    await text.fill('x'.repeat(SYSTEM_PROMPT_MAX_LENGTH))

    await expect.element(panel.getByRole('status')).not.toBeInTheDocument()
    await expect.element(save).toBeEnabled()
    await expect.element(toLibrary).toBeEnabled()
  })

  it('follows its Tools changed elsewhere', async () => {
    const tree = savedTree({title: 'Trip'})
    const main = fakeMain({trees: [tree]})
    await renderApp(main)

    const panel = await openTreePanel('Trip')

    const skills = panel
      .getByRole('group', {name: 'Built in · Claude'})
      .getByRole('switch', {name: 'Built-in Skills'})

    await expect.element(skills).not.toBeChecked()

    main.publish({
      type: 'TREE_CHANGED',
      tree: {...tree, tools: {...tree.tools, claudeBuiltInSkills: true}},
    })

    await expect.element(skills).toBeChecked()
  })
})

function deleteDialog() {
  return page.getByRole('alertdialog')
}

async function expectDeleteTreeMessage() {
  await expect
    .element(deleteDialog().getByRole('heading'))
    .toHaveTextContent('Delete Tree?')
  await expect
    .element(
      deleteDialog().getByText(
        'This Tree will be permanently deleted. This can’t be undone.'
      )
    )
    .toBeVisible()
}

async function askToDelete(name: string) {
  await sidebar()
    .getByRole('button', {name: `Actions for ${name}`})
    .click()
  await page.getByRole('menuitem', {name: 'Delete…'}).click()
  await expect.element(deleteDialog()).toBeVisible()
}

describe('deleting a Tree', () => {
  it('asks first, and Cancel keeps it', async () => {
    const main = fakeMain({trees: [savedTree({title: 'Draft'})]})
    await renderApp(main)

    await askToDelete('Draft')
    await expectDeleteTreeMessage()

    await deleteDialog().getByRole('button', {name: 'Cancel'}).click()

    await expect.element(deleteDialog()).not.toBeInTheDocument()
    await expect.element(treeRow('Draft')).toBeVisible()
    expect(sentOf(main, 'tree.delete')).toEqual([])
  })

  it('deletes the open Tree on Delete, closing it and dropping its row', async () => {
    const tree = savedTree({firstLine: 'Plan a week in Lisbon'})
    const other = savedTree({title: 'Other'})
    const main = fakeMain({trees: [tree, other]})
    await renderApp(main)
    await treeRow('Plan a week in Lisbon').click()
    await expect
      .element(page.getByRole('heading', {name: 'Plan a week in Lisbon'}))
      .toBeVisible()

    await askToDelete('Plan a week in Lisbon')
    await deleteDialog().getByRole('button', {name: 'Delete'}).click()

    expect(sentOf(main, 'tree.delete')).toEqual([
      {type: 'tree.delete', treeId: tree.id},
    ])
    await expect
      .element(treeRow('Plan a week in Lisbon'))
      .not.toBeInTheDocument()
    await expect.element(treeRow('Other')).toBeVisible()
    await expect
      .element(page.getByRole('main').getByText('No Tree open'))
      .toBeVisible()
  })

  it('deletes a Tree, saying Deleting… until main answers', async () => {
    const tree = savedTree({title: 'Busy'})
    const main = fakeMain({trees: [tree]})
    const answered = Promise.withResolvers<void>()
    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) => {
        if (command.type === 'tree.delete') await answered.promise

        return main.send(command)
      }) as Bridge['send'],
    }
    await render(<App />, {wrapper: FullHeight})

    await askToDelete('Busy')
    await deleteDialog().getByRole('button', {name: 'Delete'}).click()

    await expect
      .element(deleteDialog().getByRole('button', {name: 'Deleting…'}))
      .toBeDisabled()

    answered.resolve()

    await expect.element(treeRow('Busy')).not.toBeInTheDocument()
    await expect.element(deleteDialog()).not.toBeInTheDocument()
  })

  it('says in its dialog why main refused to delete it, and keeps its row', async () => {
    const main = fakeMain({trees: [savedTree({title: 'Kept'})]})
    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) =>
        command.type === 'tree.delete'
          ? {
              ok: false,
              error: {code: 'handler-failed', message: 'The disk is full.'},
            }
          : main.send(command)) as Bridge['send'],
    }
    await render(<App />, {wrapper: FullHeight})

    await askToDelete('Kept')
    await deleteDialog().getByRole('button', {name: 'Delete'}).click()

    await expect
      .element(deleteDialog().getByRole('alert'))
      .toHaveTextContent('The disk is full.')
    await expect
      .element(deleteDialog().getByRole('button', {name: 'Delete'}))
      .toBeEnabled()

    await deleteDialog().getByRole('button', {name: 'Cancel'}).click()
    await expect.element(treeRow('Kept')).toBeVisible()
  })
})

interface Point {
  x: number
  y: number
}

function centerOf(element: Element): Point {
  const rect = element.getBoundingClientRect()

  return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}
}

async function drag(element: Element, by: Point) {
  const from = centerOf(element)
  const mouse = {button: 'left', clickCount: 1} as const

  await cdp().send('Input.dispatchMouseEvent', {
    ...mouse,
    type: 'mousePressed',
    ...from,
  })

  for (let step = 1; step <= 5; step++) {
    await cdp().send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: from.x + (by.x * step) / 5,
      y: from.y + (by.y * step) / 5,
    })
  }

  await cdp().send('Input.dispatchMouseEvent', {
    ...mouse,
    type: 'mouseReleased',
    x: from.x + by.x,
    y: from.y + by.y,
  })
}

/** Playwright's `dblClick` refuses an element with no width, as the handle is. */
async function doubleClick(element: Element) {
  const at = {...centerOf(element), button: 'left'} as const

  for (const clickCount of [1, 2]) {
    await cdp().send('Input.dispatchMouseEvent', {
      ...at,
      clickCount,
      type: 'mousePressed',
    })
    await cdp().send('Input.dispatchMouseEvent', {
      ...at,
      clickCount,
      type: 'mouseReleased',
    })
  }
}

function layoutUpdates(main: FakeMain) {
  return main.sent.filter(command => command.type === 'layout.update')
}

function sidebarWidth() {
  return sidebar().element().getBoundingClientRect().width
}

function sidebarRight() {
  return sidebar().element().getBoundingClientRect().right
}

function sidebarPanel() {
  const panel = sidebar().element().closest('[data-panel]')

  if (!panel) throw new Error('No sidebar panel')

  return panel
}

function canvasLeft() {
  return (
    document
      .querySelector('[data-slot="sidebar-inset"]')
      ?.getBoundingClientRect().left ?? 0
  )
}

async function nextFrame() {
  return new Promise(resolve => {
    requestAnimationFrame(resolve)
  })
}

async function renderAppWithNoRoom(main: FakeMain) {
  globalThis.window.uz = main
  const room = document.createElement('div')
  room.style.height = '100vh'
  room.style.width = '0px'
  document.body.append(room)
  onTestFinished(() => room.remove())

  await render(<App />, {container: room})

  return room
}

function savedSidebarWidth() {
  return getComputedStyle(sidebar().element()).getPropertyValue(
    '--sidebar-width'
  )
}

function widthHandle() {
  return page.getByRole('separator', {name: 'Sidebar width'}).element()
}

describe('the sidebar’s width', () => {
  it('follows a drag of its edge from 290 to 640 px, saving only where the drag ends, and a double-click resets it', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(sidebarWidth).toBe(290)

    await drag(widthHandle(), {x: 110, y: 0})
    await expect.poll(sidebarWidth).toBe(400)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarWidth: 400}},
    ])

    await drag(widthHandle(), {x: 500, y: 0})
    await expect.poll(sidebarWidth).toBe(640)

    await doubleClick(widthHandle())
    await expect.poll(sidebarWidth).toBe(290)

    await drag(widthHandle(), {x: -100, y: 0})
    await expect.poll(sidebarWidth).toBe(290)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarWidth: 400}},
      {type: 'layout.update', changes: {sidebarWidth: 640}},
      {type: 'layout.update', changes: {sidebarWidth: 290}},
    ])
  })

  it('slides open at its full width', async () => {
    await renderApp(fakeMain({layout: {sidebarOpen: false}}))
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)

    await cdp().send('Animation.enable')
    await setPlaybackRate(0)
    onTestFinished(async () => setPlaybackRate(1))
    await userEvent.keyboard('{Meta>}b{/Meta}')

    await expect.poll(() => flexGrowTransition(sidebarPanel())).toBeDefined()
    const transition = flexGrowTransition(sidebarPanel())

    if (!transition) throw new Error('No flex-grow transition')

    transition.currentTime = 200
    await nextFrame()
    await nextFrame()
    expect(sidebarRight()).toBeGreaterThan(0)
    expect(sidebarRight()).toBeLessThan(290)
    expect(sidebarWidth()).toBe(290)
  })

  it('follows a drag at once after it slides closed and open again', async () => {
    await renderApp(fakeMain())
    await expect.poll(sidebarRight).toBe(290)

    await userEvent.keyboard('{Meta>}b{/Meta}')
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)
    await userEvent.keyboard('{Meta>}b{/Meta}')
    await expect.poll(sidebarRight).toBe(290)

    await drag(widthHandle(), {x: 110, y: 0})
    expect(canvasLeft()).toBe(400)
  })

  it('opens as wide as it was saved', async () => {
    await renderApp(fakeMain({layout: {sidebarWidth: 500}}))

    await expect.poll(sidebarWidth).toBe(500)
  })

  it('opens as wide as it was saved when it mounts with no width, then gets some', async () => {
    const room = await renderAppWithNoRoom(
      fakeMain({layout: {sidebarWidth: 400}})
    )

    await expect.poll(savedSidebarWidth).toBe('400px')

    room.style.width = '1000px'

    await expect.poll(sidebarWidth).toBe(400)
  })

  it('saves nothing when a double-click finds it at its default width', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(sidebarWidth).toBe(290)

    await doubleClick(widthHandle())
    await drag(widthHandle(), {x: 110, y: 0})

    await expect.poll(sidebarWidth).toBe(400)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarWidth: 400}},
    ])
  })

  it('saves no width it only opened at, even one main saved between whole pixels', async () => {
    const main = fakeMain({layout: {sidebarWidth: 400.4}})
    await renderApp(main)
    await expect.poll(sidebarWidth).toBeCloseTo(400.4, 0)

    await drag(widthHandle(), {x: 110, y: 0})

    await expect.poll(sidebarWidth).toBeCloseTo(510.4, 0)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarWidth: 510}},
    ])
  })
})

function section(name: 'Trees' | 'Files' | 'Usage') {
  return page.getByRole('region', {name})
}

function heightOf(name: 'Trees' | 'Files' | 'Usage') {
  return section(name).element().getBoundingClientRect().height
}

function header(name: 'Trees' | 'Files' | 'Usage') {
  return section(name).getByRole('button', {name, exact: true})
}

function dividers() {
  return sidebar()
    .getByRole('separator')
    .elements()
    .filter(
      element => element.getAttribute('aria-orientation') === 'horizontal'
    )
}

function divider(index: number) {
  const found = dividers()[index]

  if (!found) throw new Error(`No divider ${index}`)

  return found
}

function panelOf(name: 'Trees' | 'Files' | 'Usage') {
  const panel = section(name).element().closest('[data-panel]')

  if (!panel) throw new Error(`No panel for ${name}`)

  return panel
}

function flexGrowTransition(element: Element) {
  return element
    .getAnimations()
    .find(
      animation =>
        animation instanceof CSSTransition &&
        animation.transitionProperty === 'flex-grow'
    )
}

async function setPlaybackRate(playbackRate: number) {
  await cdp().send('Animation.setPlaybackRate', {playbackRate})
}

function savedSections(main: FakeMain) {
  return layoutUpdates(main).map(command => command.changes.sidebarSections)
}

describe('the sidebar’s sections', () => {
  it('collapses Files to its header and expands it to the height it had, saving each', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(() => heightOf('Files')).toBeGreaterThan(180)
    const before = {trees: heightOf('Trees'), files: heightOf('Files')}

    const headerHeight = header('Files')
      .element()
      .getBoundingClientRect().height

    await header('Files').click()

    await expect
      .element(header('Files'))
      .toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => heightOf('Files')).toBe(headerHeight)
    expect(heightOf('Trees')).toBeGreaterThan(before.trees)
    expect(savedSections(main)).toEqual([
      {
        trees: {size: 55, collapsed: false},
        files: {size: 30, collapsed: true},
        usage: {size: 15, collapsed: false},
      },
    ])

    await header('Files').click()

    await expect.poll(() => heightOf('Files')).toBeCloseTo(before.files, 0)
    expect(heightOf('Trees')).toBeCloseTo(before.trees, 0)
    expect(savedSections(main).at(-1)).toEqual({
      trees: {size: 55, collapsed: false},
      files: {size: 30, collapsed: false},
      usage: {size: 15, collapsed: false},
    })
  })

  it('keeps the open sections’ split beside a collapsed one when the window grows', async () => {
    const {container} = await renderApp(fakeMain())
    const frame = container.firstElementChild

    if (!(frame instanceof HTMLElement)) throw new Error('No frame')

    const headerHeight = header('Files')
      .element()
      .getBoundingClientRect().height

    await header('Files').click()
    await expect.poll(() => heightOf('Files')).toBe(headerHeight)
    const split = heightOf('Trees') / heightOf('Usage')

    frame.style.height = '200vh'
    await expect.poll(() => heightOf('Files')).toBeCloseTo(headerHeight, 0)

    expect(heightOf('Trees') / heightOf('Usage')).toBeCloseTo(split, 1)
  })

  it('opens with the split and collapsed sections it was saved with', async () => {
    await renderApp(
      fakeMain({
        layout: {
          sidebarSections: {
            trees: {size: 40, collapsed: false},
            files: {size: 30, collapsed: true},
            usage: {size: 30, collapsed: false},
          },
        },
      })
    )
    await expect
      .element(header('Files'))
      .toHaveAttribute('aria-expanded', 'false')

    const headerHeight = header('Files')
      .element()
      .getBoundingClientRect().height

    await expect.poll(() => heightOf('Files')).toBe(headerHeight)
    expect(heightOf('Trees') / heightOf('Usage')).toBeCloseTo(40 / 30, 1)
  })

  it('saves a divider’s drag once it ends, and a double-click resets the split', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(() => heightOf('Files')).toBeGreaterThan(180)
    const before = {trees: heightOf('Trees'), files: heightOf('Files')}

    await drag(divider(0), {x: 0, y: -100})

    await expect
      .poll(() => heightOf('Trees'))
      .toBeCloseTo(before.trees - 100, 0)
    expect(heightOf('Files')).toBeCloseTo(before.files + 100, 0)
    expect(savedSections(main)).toHaveLength(1)
    const [dragged] = savedSections(main)
    expect(dragged?.trees.size).toBeLessThan(55)
    expect(dragged?.usage).toEqual({size: 15, collapsed: false})

    await userEvent.dblClick(divider(0))

    await expect.poll(() => heightOf('Trees')).toBeCloseTo(before.trees, 0)
    expect(savedSections(main).at(-1)).toEqual({
      trees: {size: 55, collapsed: false},
      files: {size: 30, collapsed: false},
      usage: {size: 15, collapsed: false},
    })
  })

  it('stops each section at its minimum height', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(() => heightOf('Files')).toBeGreaterThan(180)

    await drag(divider(0), {x: 0, y: -800})
    await expect.poll(() => heightOf('Trees')).toBeCloseTo(120, 0)

    await drag(divider(1), {x: 0, y: 800})
    await expect.poll(() => heightOf('Usage')).toBeCloseTo(90, 0)

    await drag(divider(0), {x: 0, y: 800})
    await expect.poll(() => heightOf('Files')).toBeCloseTo(180, 0)
    expect(heightOf('Usage')).toBeCloseTo(90, 0)
  })

  it('animates a section collapsing', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(() => heightOf('Files')).toBeGreaterThan(180)

    const open = heightOf('Files')

    const headerHeight = header('Files')
      .element()
      .getBoundingClientRect().height

    await cdp().send('Animation.enable')
    await setPlaybackRate(0)
    onTestFinished(async () => setPlaybackRate(1))
    await header('Files').click()

    await expect.poll(() => flexGrowTransition(panelOf('Files'))).toBeDefined()
    const transition = flexGrowTransition(panelOf('Files'))

    if (!transition) throw new Error('No flex-grow transition')

    transition.currentTime = 100
    expect(heightOf('Files')).toBeGreaterThan(headerHeight)
    expect(heightOf('Files')).toBeLessThan(open)

    await setPlaybackRate(1)
    await expect.poll(() => heightOf('Files')).toBe(headerHeight)
  })

  it('follows a divider drag at once after a section collapses and expands', async () => {
    await renderApp(fakeMain())
    await expect.poll(() => heightOf('Files')).toBeGreaterThan(180)
    const open = heightOf('Files')

    await header('Files').click()
    await expect
      .element(header('Files'))
      .toHaveAttribute('aria-expanded', 'false')
    await header('Files').click()
    await expect.poll(() => heightOf('Files')).toBeCloseTo(open, 0)

    const trees = heightOf('Trees')
    await drag(divider(0), {x: 0, y: 40})
    expect(heightOf('Trees')).toBeCloseTo(trees + 40, 0)
  })

  it('keeps the dividers beside a collapsed section from moving', async () => {
    const main = fakeMain()
    await renderApp(main)

    const headerHeight = header('Files')
      .element()
      .getBoundingClientRect().height

    await header('Files').click()
    await expect.poll(() => heightOf('Files')).toBe(headerHeight)
    const before = {trees: heightOf('Trees'), usage: heightOf('Usage')}

    await drag(divider(0), {x: 0, y: -100})
    await drag(divider(1), {x: 0, y: 100})

    expect(heightOf('Trees')).toBe(before.trees)
    expect(heightOf('Usage')).toBe(before.usage)
    expect(savedSections(main)).toHaveLength(1)
  })
})

interface SavedTurn {
  text: string
  files?: ChangedFile[]
  snapshot: FakeSnapshot
}

function savedThread(tree: Tree, ...turns: SavedTurn[]) {
  const prompts: Prompt[] = []
  const replies: Reply[] = []
  const snapshots: Record<string, FakeSnapshot> = {}

  for (const [nth, turn] of turns.entries()) {
    const createdAt = new Date(
      Date.parse(receivedAt) + nth * MINUTE
    ).toISOString()

    const prompt: Prompt = {
      id: crypto.randomUUID(),
      treeId: tree.id,
      parentReplyId: replies.at(-1)?.id ?? null,
      text: `Prompt ${nth + 1}`,
      attachments: [],
      createdAt,
    }

    const reply: Reply = {
      id: crypto.randomUUID(),
      treeId: tree.id,
      promptId: prompt.id,
      provider: 'claude',
      model: 'fake',
      status: 'complete',
      content: [{type: 'text', text: turn.text}],
      contextSize: null,
      contextWindow: null,
      failure: null,
      compacted: false,
      rebuilt: false,
      systemPromptId: tree.systemPrompt.id,
      files: turn.files ?? [],
      createdAt,
    }

    prompts.push(prompt)
    replies.push(reply)
    snapshots[reply.id] = turn.snapshot
  }

  return {trees: [tree], prompts, replies, snapshots}
}

function filesSection() {
  return page.getByRole('region', {name: 'Files'})
}

function fileRows() {
  const host = filesSection().element().querySelector('file-tree-container')
  const rows = host?.shadowRoot?.querySelectorAll('[data-item-path]') ?? []

  return [...rows].flatMap(row =>
    row.getAttribute('data-item-type') === 'folder'
      ? []
      : [
          [
            row.getAttribute('data-item-path'),
            row.getAttribute('data-item-git-status'),
          ],
        ]
  )
}

function fileRow(path: string) {
  const host = filesSection().element().querySelector('file-tree-container')
  const row = host?.shadowRoot?.querySelector(`[data-item-path="${path}"]`)

  if (!row) throw new Error(`${path} is not in the Files section`)

  return page.elementLocator(row)
}

function turnNode(text: string) {
  const box = page.getByText(text).element().closest('.react-flow__node')

  if (!box) throw new Error(`${text} is not on the canvas`)

  return page.elementLocator(box)
}

function preview() {
  return page.getByRole('dialog', {name: 'File preview'})
}

const earlier = {
  text: 'Reply one',
  files: [{path: 'notes.md', change: 'created', size: 12}],
  snapshot: {
    onDisk: false,
    files: [treeFile('notes.md', {change: 'created'})],
  },
} satisfies SavedTurn

const latest = {
  text: 'Reply two',
  files: [
    {path: 'notes.md', change: 'edited', size: 20},
    {path: 'src/plan.txt', change: 'created', size: 5},
    {path: 'old.txt', change: 'deleted', size: null},
  ],
  snapshot: {
    onDisk: true,
    files: [
      treeFile('notes.md', {change: 'edited', size: 20}),
      treeFile('old.txt', {change: 'deleted'}),
      treeFile('readme.txt'),
      treeFile('src/plan.txt', {change: 'created', size: 5}),
    ],
  },
} satisfies SavedTurn

async function openTreeOf(main: FakeMain, title: string) {
  await renderApp(main)
  await treeRow(title).click()
  await expect.element(page.getByText('Reply two')).toBeVisible()
}

describe('the Files section', () => {
  it('shows the Snapshot where the Active Thread ends, deleted files too, each colored by what that Reply did', async () => {
    const tree = savedTree({title: 'Notes'})
    const main = fakeMain(savedThread(tree, earlier, latest))
    await openTreeOf(main, 'Notes')

    await expect.poll(fileRows).toEqual([
      ['src/plan.txt', 'added'],
      ['notes.md', 'modified'],
      ['old.txt', 'deleted'],
      ['readme.txt', null],
    ])
    expect(sentOf(main, 'tree-files.list').at(-1)).toEqual({
      type: 'tree-files.list',
      treeId: tree.id,
      replyId: main.replies[1]?.id,
    })
    await expect
      .element(filesSection().getByText('as they were at an earlier Turn'))
      .not.toBeInTheDocument()
  })

  it('follows the Reply the chat slideout opens at, then the leaf whose Input takes focus, keeping its folders open', async () => {
    const tree = savedTree({title: 'Notes'})
    const main = fakeMain(savedThread(tree, earlier, latest))
    await openTreeOf(main, 'Notes')
    await expect.poll(fileRows).toHaveLength(4)

    await turnNode('Reply one')
      .getByRole('button', {name: 'Open in Chat mode'})
      .first()
      .click()

    await expect.poll(fileRows).toEqual([['notes.md', 'added']])

    // Focusing a leaf's Input, under the slideout here, closes the slideout and makes its Thread active.
    turnNode('Reply two')
      .getByRole('textbox', {name: 'Prompt'})
      .element()
      .focus()

    await expect
      .element(page.getByRole('dialog', {name: 'Chat'}))
      .not.toHaveAttribute('data-open')
    await expect.poll(fileRows).toHaveLength(4)
  })

  it('says files at an earlier Turn are as they were then, and saves a copy of them', async () => {
    const tree = savedTree({title: 'Notes'})
    const later = {...latest, snapshot: {...latest.snapshot, onDisk: false}}
    const main = fakeMain(savedThread(tree, earlier, later))
    await openTreeOf(main, 'Notes')

    await expect
      .element(
        filesSection().getByText(
          'These files are as they were at an earlier Turn.'
        )
      )
      .toBeVisible()
    await filesSection().getByRole('button', {name: 'Save a copy…'}).click()

    expect(sentOf(main, 'tree-files.save-copy')).toEqual([
      {
        type: 'tree-files.save-copy',
        treeId: tree.id,
        replyId: main.replies[1]?.id,
      },
    ])
  })

  it.each([
    ['no files', []],
    ['only files it deleted', [treeFile('old.txt', {change: 'deleted'})]],
  ])(
    'offers no Save a copy… for an earlier Turn with %s',
    async (_case, files) => {
      const tree = savedTree({title: 'Notes'})
      const later = {...latest, snapshot: {onDisk: false, files}}
      const main = fakeMain(savedThread(tree, earlier, later))
      await openTreeOf(main, 'Notes')

      await expect
        .element(
          filesSection().getByText(
            'These files are as they were at an earlier Turn.'
          )
        )
        .toBeVisible()
      await expect
        .element(filesSection().getByRole('button', {name: 'Save a copy…'}))
        .not.toBeInTheDocument()
    }
  )

  it('says so when no Tree is open, and when the open Tree has no files yet', async () => {
    const tree = savedTree({title: 'Empty'})
    const main = fakeMain({trees: [tree]})
    await renderApp(main)

    await expect
      .element(filesSection().getByText('No Tree open.'))
      .toBeVisible()

    await treeRow('Empty').click()

    await expect
      .element(filesSection().getByText('No files yet.'))
      .toBeVisible()
  })

  it('shows the files a Reply wrote once main says its files changed', async () => {
    const tree = savedTree({title: 'Notes'})
    const empty = {...latest, files: [], snapshot: {onDisk: true, files: []}}
    const main = fakeMain(savedThread(tree, empty))
    await renderApp(main)
    await treeRow('Notes').click()
    await expect
      .element(filesSection().getByText('No files yet.'))
      .toBeVisible()

    const [reply] = main.replies

    if (!reply) throw new Error('No Reply')

    main.snapshots[reply.id] = latest.snapshot
    main.publish({
      type: 'FILES_CHANGED',
      treeId: tree.id,
      replyId: reply.id,
      files: latest.files,
    })

    await expect.poll(fileRows).toHaveLength(4)
  })
})

describe('a file’s preview', () => {
  it('opens a file clicked in the tree, and opens it again after it was closed', async () => {
    const tree = savedTree({title: 'Notes'})
    const main = fakeMain(savedThread(tree, earlier, latest))
    await openTreeOf(main, 'Notes')
    await expect.poll(fileRows).toHaveLength(4)

    await fileRow('readme.txt').click()

    await expect
      .element(preview().getByRole('heading'))
      .toHaveTextContent('readme.txt')
    await preview().getByRole('button', {name: 'Close preview'}).click()
    await expect.element(preview()).not.toBeInTheDocument()

    await fileRow('readme.txt').click()

    await expect.element(preview()).toBeVisible()
  })

  it('opens a chip’s file as it was at that chip’s Reply', async () => {
    const tree = savedTree({title: 'Notes'})
    const main = fakeMain(savedThread(tree, earlier, latest))
    await openTreeOf(main, 'Notes')

    await turnNode('Reply one')
      .getByRole('button', {name: 'Open notes.md'})
      .click()

    await expect
      .element(preview().getByText('How this file looked at this Turn.'))
      .toBeVisible()
    expect(sentOf(main, 'tree-file.describe')).toEqual([
      {type: 'tree-file.describe', fileId: earlier.snapshot.files[0]?.id},
    ])
  })

  it('closes on Esc, leaving the chat slideout open', async () => {
    const tree = savedTree({title: 'Notes'})
    const main = fakeMain(savedThread(tree, earlier, latest))
    await openTreeOf(main, 'Notes')
    await turnNode('Reply two')
      .getByRole('button', {name: 'Open in Chat mode'})
      .first()
      .click()
    const slideout = page.getByRole('dialog', {name: 'Chat'})
    await expect.element(slideout).toBeVisible()

    await slideout.getByRole('button', {name: 'Open src/plan.txt'}).click()
    await expect.element(preview()).toBeVisible()
    await userEvent.keyboard('{Escape}')

    await expect.element(preview()).not.toBeInTheDocument()
    expect(slideout.element()).toHaveAttribute('data-open')
  })
})
