// The Playwright provider gives `cdp()` its `send`.
/// <reference types="@vitest/browser-playwright" />
import type {FakeMain} from '../fake-main'
import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {Tree} from '@uz/contract/trees'
import type {ReactNode} from 'react'

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

import {fakeMain, savedTree} from '../fake-main'
import {App} from './App'

const MINUTE = 60_000

const NOW = Date.parse('2026-11-01T12:00:00.000Z')

function minutesAgo(minutes: number) {
  return new Date(NOW - minutes * MINUTE).toISOString()
}

afterEach(() => {
  vi.useRealTimers()
})

/** The canvas fills its parent, so it needs one with a height. */
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
    const tree = savedTree({firstLine: 'Plan a week in Lisbon', turnCount: 2})
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

  it('calls a Tree with no Prompt yet Untitled Tree, in italics', async () => {
    await renderApp(fakeMain({trees: [savedTree()]}))

    await expect.element(treeRow('Untitled Tree')).toBeVisible()
    expect(fontStyle('Untitled Tree')).toBe('italic')
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
  it('renames it with F2', async () => {
    const main = fakeMain({trees: [savedTree({title: 'Draft'})]})
    await renderApp(main)

    await treeRow('Draft').click()
    await userEvent.keyboard('{F2}')
    await page.getByRole('textbox', {name: 'Tree name'}).fill('Trip planning')
    await userEvent.keyboard('{Enter}')

    await expect.element(treeRow('Trip planning')).toBeVisible()
  })

  it('starts an untitled Tree from its first line, which Enter leaves untitled', async () => {
    const main = fakeMain({
      trees: [savedTree({firstLine: 'Plan a week in Lisbon', turnCount: 2})],
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

  it('renames it from its ⋯ menu, which holds only Rename and Delete…', async () => {
    await renderApp(
      fakeMain({
        trees: [
          savedTree({title: 'Draft', turnCount: 2}),
          savedTree({title: 'Other'}),
        ],
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
    ).toEqual(['Rename', 'Delete…'])

    await menu.getByRole('menuitem', {name: 'Rename'}).click()
    await expect.element(menu).not.toBeInTheDocument()

    const input = page.getByRole('textbox', {name: 'Tree name'})
    await expect.element(input).toHaveFocus()
    await userEvent.keyboard('Trip planning{Enter}')

    await expect.element(treeRow('Trip planning')).toBeVisible()
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
    const main = fakeMain({trees: [savedTree({title: 'Draft', turnCount: 3})]})
    await renderApp(main)

    await askToDelete('Draft')
    await expectDeleteTreeMessage()

    await deleteDialog().getByRole('button', {name: 'Cancel'}).click()

    await expect.element(deleteDialog()).not.toBeInTheDocument()
    await expect.element(treeRow('Draft')).toBeVisible()
    expect(sentOf(main, 'tree.delete')).toEqual([])
  })

  it('deletes the open Tree on Delete, closing it and dropping its row', async () => {
    const tree = savedTree({firstLine: 'Plan a week in Lisbon', turnCount: 1})
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

  it('deletes the open Tree from its root Prompt, asking the same as its row does', async () => {
    const tree = savedTree({title: 'Lisbon trip', turnCount: 2})
    const other = savedTree({title: 'Other'})

    const root = {
      id: crypto.randomUUID(),
      treeId: tree.id,
      parentReplyId: null,
      text: 'Plan a week in Lisbon',
      createdAt: minutesAgo(5),
    }

    const main = fakeMain({
      trees: [tree, other],
      prompts: [root],
      replies: [
        {
          id: crypto.randomUUID(),
          treeId: tree.id,
          promptId: root.id,
          provider: 'claude',
          model: 'fake',
          status: 'complete',
          content: [{type: 'text', text: 'Start in Alfama'}],
          contextSize: null,
          contextWindow: null,
          failure: null,
          createdAt: minutesAgo(5),
        },
      ],
    })

    await renderApp(main)
    await treeRow('Lisbon trip').click()
    await expect.element(page.getByText('Start in Alfama')).toBeVisible()

    await page.getByText('Plan a week in Lisbon').hover()
    await page.getByRole('button', {name: 'Delete this Tree'}).click()
    await expectDeleteTreeMessage()
    await deleteDialog().getByRole('button', {name: 'Delete'}).click()

    expect(sentOf(main, 'tree.delete')).toEqual([
      {type: 'tree.delete', treeId: tree.id},
    ])
    expect(sentOf(main, 'prompt.delete')).toEqual([])
    await expect.element(treeRow('Lisbon trip')).not.toBeInTheDocument()
    await expect.element(treeRow('Other')).toBeVisible()
    await expect
      .element(page.getByRole('main').getByText('No Tree open'))
      .toBeVisible()
  })

  it('deletes an empty Tree at once, without asking', async () => {
    const tree = savedTree({title: 'Empty'})
    const main = fakeMain({trees: [tree]})
    await renderApp(main)

    await sidebar().getByRole('button', {name: 'Actions for Empty'}).click()
    await page.getByRole('menuitem', {name: 'Delete', exact: true}).click()

    await expect.element(treeRow('Empty')).not.toBeInTheDocument()
    expect(sentOf(main, 'tree.delete')).toEqual([
      {type: 'tree.delete', treeId: tree.id},
    ])
    expect(deleteDialog().query()).toBeNull()
  })

  it('says why main refused to delete it, and keeps its row', async () => {
    const main = fakeMain({trees: [savedTree({title: 'Busy', turnCount: 1})]})
    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) =>
        command.type === 'tree.delete'
          ? {
              ok: false,
              error: {
                code: 'handler-failed',
                message: 'A Reply in this Tree is still being written.',
              },
            }
          : main.send(command)) as Bridge['send'],
    }
    await render(<App />, {wrapper: FullHeight})

    await askToDelete('Busy')
    await deleteDialog().getByRole('button', {name: 'Delete'}).click()

    await expect
      .element(
        sidebar().getByText('A Reply in this Tree is still being written.')
      )
      .toBeVisible()
    await expect.element(treeRow('Busy')).toBeVisible()
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

/** A real mouse drag, in steps, the way a hand moves one. */
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

  it('widens and narrows from the keyboard, saving each width it lands on', async () => {
    const main = fakeMain()
    await renderApp(main)
    await expect.poll(sidebarWidth).toBe(290)

    const handle = widthHandle()

    if (!(handle instanceof HTMLElement)) throw new Error('No width handle')

    handle.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(sidebarWidth).toBeGreaterThan(290)
    const wider = sidebarWidth()

    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(sidebarWidth).toBeGreaterThan(wider)
    const widest = sidebarWidth()

    await userEvent.keyboard('{ArrowLeft}')
    await expect.poll(sidebarWidth).toBe(wider)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarWidth: wider}},
      {type: 'layout.update', changes: {sidebarWidth: widest}},
      {type: 'layout.update', changes: {sidebarWidth: wider}},
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

/** The dividers between the sections, top to bottom. */
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
