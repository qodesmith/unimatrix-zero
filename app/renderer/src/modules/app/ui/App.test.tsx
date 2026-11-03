/// <reference types="@vitest/browser-playwright" />
import type {FakeMain} from '../fake-main'
import type {Bridge} from '@uz/contract/bridge'
import type {Command, CommandOutcome} from '@uz/contract/commands'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {describe, expect, it, onTestFinished} from 'vitest'
import {render} from 'vitest-browser-react'
import {cdp, page, userEvent} from 'vitest/browser'

import {account, fakeMain, receivedAt, savedTree} from '../fake-main'
import {App} from './App'

/** The canvas fills its parent, so it needs one with a height. */
function FullHeight({children}: {children: ReactNode}) {
  return <div style={{height: '100vh'}}>{children}</div>
}

async function renderApp() {
  return render(<App />, {wrapper: FullHeight})
}

function firstReply(main: FakeMain) {
  const [reply] = main.replies

  if (!reply) throw new Error('No Reply was started')

  return {treeId: reply.treeId, replyId: reply.id}
}

function sidebarNewTree() {
  return page.getByRole('complementary').getByRole('button', {name: 'New Tree'})
}

function viewport() {
  return (
    document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
  )
}

function zoomOf() {
  const scale = /scale\(([\d.]+)\)/.exec(viewport())?.[1]

  return scale === undefined ? Number.NaN : Number(scale)
}

/** '' clears the emulation: no preference. */
async function emulateReducedMotion(value: 'reduce' | '') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{name: 'prefers-reduced-motion', value}],
  })
}

function watchTransitions() {
  const slots: (string | null)[] = []

  function record(event: TransitionEvent) {
    if (event.target instanceof Element) {
      slots.push(event.target.getAttribute('data-slot'))
    }
  }

  document.addEventListener('transitionrun', record)
  onTestFinished(() => document.removeEventListener('transitionrun', record))

  return slots
}

function settingsSheet() {
  return page.getByRole('dialog', {name: 'Settings'})
}

async function openSettings() {
  await page
    .getByRole('complementary')
    .getByRole('button', {name: 'Settings'})
    .click()
  await expect
    .element(settingsSheet().getByRole('heading', {name: 'Appearance'}))
    .toBeVisible()
}

async function startStreaming(main: FakeMain) {
  await sidebarNewTree().click()
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')

  const ids = firstReply(main)
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'Hi '})
  await expect.element(page.getByText('Hi', {exact: true})).toBeVisible()

  return ids
}

it('opens Settings in a Sheet over the Tree, and closing it with the X shows the same Tree at the same pan and zoom', async () => {
  const tree = savedTree({title: 'Trip planning'})

  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId: tree.id,
    parentReplyId: null,
    text: 'Where to?',
    createdAt: receivedAt,
  }

  globalThis.window.uz = fakeMain({
    trees: [tree],
    prompts: [prompt],
    replies: [
      {
        id: crypto.randomUUID(),
        treeId: tree.id,
        promptId: prompt.id,
        provider: 'claude',
        model: 'fake',
        status: 'complete',
        content: [{type: 'text', text: 'Lisbon'}],
        contextSize: null,
        contextWindow: null,
        failure: null,
        createdAt: receivedAt,
      },
    ],
  })
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  await renderApp()
  await page.getByRole('button', {name: 'Trip planning'}).click()
  await expect.element(page.getByText('Lisbon')).toBeVisible()
  await expect.poll(() => document.querySelector('.canvas-fitting')).toBeNull()

  const loaded = zoomOf()
  await page.getByRole('button', {name: 'Zoom in'}).click()
  await expect.poll(zoomOf).toBeGreaterThan(loaded * 1.1)
  const zoomedIn = viewport()

  await openSettings()
  await settingsSheet().getByRole('button', {name: 'Close'}).click()

  await expect.element(settingsSheet()).not.toBeInTheDocument()
  await expect
    .element(page.getByRole('heading', {name: 'Trip planning'}))
    .toBeVisible()
  expect(viewport()).toBe(zoomedIn)
})

it('opens and closes Settings without sliding or fading when the OS asks for reduced motion', async () => {
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  globalThis.window.uz = fakeMain()
  await renderApp()
  const moved = watchTransitions()

  await openSettings()
  await settingsSheet().getByRole('button', {name: 'Close'}).click()
  await expect.element(settingsSheet()).not.toBeInTheDocument()

  expect(
    moved.filter(slot => slot === 'sheet-content' || slot === 'sheet-overlay')
  ).toEqual([])
})

it('closes only Settings on Esc over a streaming Reply and the slideout: the Reply is not stopped, and the slideout shows the text that came meanwhile', async () => {
  const main = fakeMain()
  globalThis.window.uz = main
  await renderApp()
  const ids = await startStreaming(main)
  await page.getByRole('button', {name: 'Open in Chat mode'}).click()
  const slideout = page.getByRole('complementary', {name: 'Chat'})
  await expect.element(slideout).toBeVisible()

  await openSettings()
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'there'})
  await userEvent.keyboard('{Escape}')
  await expect.element(settingsSheet()).not.toBeInTheDocument()

  await expect.element(slideout.getByText('Hi there')).toBeVisible()
  expect(main.sent.map(command => command.type)).not.toContain('reply.stop')
})

it('creates a Tree and opens it', async () => {
  globalThis.window.uz = fakeMain()
  await renderApp()
  await expect
    .element(page.getByRole('complementary').getByText('Start a new Tree'))
    .toBeVisible()

  await sidebarNewTree().click()

  await expect
    .element(page.getByRole('button', {name: 'Untitled Tree'}))
    .toHaveAttribute('aria-current', 'page')
  await expect
    .element(page.getByRole('heading', {name: 'Untitled Tree'}))
    .toBeVisible()
})

it('continues the Thread from its last Reply once that Reply has finished', async () => {
  const main = fakeMain()
  globalThis.window.uz = main
  await renderApp()
  await sidebarNewTree().click()
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')

  const first = firstReply(main)
  main.publish({...first, type: 'TEXT_DELTA', delta: 'Hi there'})
  await expect.element(page.getByText('Hi there')).toBeVisible()
  await expect.element(page.getByText('Writing…')).toBeVisible()

  const input = page.getByRole('textbox', {name: 'Prompt'})
  const send = page.getByRole('button', {name: 'Send'})
  await expect.element(input).toHaveFocus()
  await input.fill('And then?')
  await userEvent.keyboard('{Enter}')
  await expect.element(send).toBeDisabled()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({text: 'Hello?'}),
  ])

  main.publish({...first, type: 'RUN_FINISHED', status: 'complete'})
  const [saved] = main.replies

  if (!saved) throw new Error('No Reply was started')

  main.replies[0] = {
    ...saved,
    status: 'complete',
    content: [{type: 'text', text: 'Hi there'}],
  }
  await expect.element(send).toBeEnabled()
  await expect.element(page.getByText('Writing…')).not.toBeInTheDocument()
  await expect.element(input).toHaveValue('And then?')
  await userEvent.keyboard('{Enter}')

  await expect.element(page.getByText('And then?')).toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: null, text: 'Hello?'}),
    expect.objectContaining({parentReplyId: first.replyId, text: 'And then?'}),
  ])

  const [, second] = main.replies

  if (!second) throw new Error('No second Reply was started')

  main.publish({
    treeId: second.treeId,
    replyId: second.id,
    type: 'TEXT_DELTA',
    delta: 'Then the end.',
  })
  await expect.element(page.getByText('Then the end.')).toBeVisible()
  await expect.element(page.getByText('Hi there')).toBeVisible()
})

it('shows a streaming Reply where it was after a reload, and keeps going', async () => {
  const tree = savedTree({title: 'Mid-stream'})

  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId: tree.id,
    parentReplyId: null,
    text: 'Tell me',
    createdAt: receivedAt,
  }

  const reply: Reply = {
    id: crypto.randomUUID(),
    treeId: tree.id,
    promptId: prompt.id,
    provider: 'claude',
    model: 'fake',
    status: 'streaming',
    content: [{type: 'text', text: 'Once'}],
    contextSize: null,
    contextWindow: null,
    failure: null,
    createdAt: receivedAt,
  }

  const ids = {treeId: tree.id, replyId: reply.id}

  const main = fakeMain({
    trees: [tree],
    prompts: [prompt],
    replies: [reply],
    streaming: [
      {
        ...ids,
        status: 'streaming',
        content: [{type: 'text', text: 'Once upon a'}],
        contextSize: null,
        contextWindow: null,
        failure: null,
      },
    ],
  })

  globalThis.window.uz = main
  await renderApp()

  await page.getByRole('button', {name: 'Mid-stream'}).click()
  await expect.element(page.getByText('Once upon a')).toBeVisible()

  main.publish({...ids, type: 'TEXT_DELTA', delta: ' time'})
  await expect.element(page.getByText('Once upon a time')).toBeVisible()
})

function claudeCard() {
  return page.getByRole('region', {name: 'Claude'})
}

function chatgptCard() {
  return page.getByRole('region', {name: 'ChatGPT'})
}

function sidebarRight() {
  return page
    .getByRole('complementary')
    .first()
    .element()
    .getBoundingClientRect().right
}

function canvasWidth() {
  return (
    document
      .querySelector('[data-slot="sidebar-inset"]')
      ?.getBoundingClientRect().width ?? 0
  )
}

function layoutUpdates(main: FakeMain) {
  return main.sent.filter(command => command.type === 'layout.update')
}

function watchCanvasWidths() {
  const widths: number[] = []

  const resized = new ResizeObserver(entries => {
    for (const entry of entries) widths.push(entry.contentRect.width)
  })

  const added = new MutationObserver(() => {
    const canvas = document.querySelector('[data-slot="sidebar-inset"]')

    if (canvas) {
      resized.observe(canvas)
      added.disconnect()
    }
  })

  added.observe(document.body, {subtree: true, childList: true})
  onTestFinished(() => {
    added.disconnect()
    resized.disconnect()
  })

  return widths
}

describe('collapsing the sidebar', () => {
  it('closes from the trigger and opens again with ⌘B, saving each, while the canvas takes the freed width', async () => {
    const main = fakeMain()
    globalThis.window.uz = main
    await renderApp()
    await expect.poll(sidebarRight).toBeGreaterThan(0)
    const besideSidebar = canvasWidth()
    const moved = watchTransitions()

    await page.getByRole('button', {name: 'Toggle Sidebar'}).click()

    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)
    await expect.poll(canvasWidth).toBe(globalThis.innerWidth)
    expect(besideSidebar).toBeLessThan(globalThis.innerWidth)

    await userEvent.keyboard('{Meta>}b{/Meta}')

    await expect.poll(sidebarRight).toBeGreaterThan(0)
    await expect.poll(canvasWidth).toBe(besideSidebar)
    expect(moved).toContain('resizable-panel')
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarOpen: false}},
      {type: 'layout.update', changes: {sidebarOpen: true}},
    ])
  })

  it('closes and opens again without sliding when the OS asks for reduced motion', async () => {
    await emulateReducedMotion('reduce')
    onTestFinished(async () => emulateReducedMotion(''))
    globalThis.window.uz = fakeMain()
    await renderApp()
    await expect.poll(sidebarRight).toBeGreaterThan(0)
    const moved = watchTransitions()

    await page.getByRole('button', {name: 'Toggle Sidebar'}).click()
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)
    await userEvent.keyboard('{Meta>}b{/Meta}')
    await expect.poll(sidebarRight).toBeGreaterThan(0)

    expect(moved.filter(slot => slot === 'resizable-panel')).toEqual([])
  })

  it('closes from the trigger beside an open Tree’s title', async () => {
    const main = fakeMain({
      trees: [savedTree({title: 'Draft'})],
    })

    globalThis.window.uz = main
    await renderApp()
    await page.getByRole('button', {name: 'Draft'}).click()

    const title = page.getByRole('heading', {name: 'Draft'})
    await expect.element(title).toBeVisible()
    const header = title.element().parentElement

    if (!header) throw new Error('The Tree’s title has no header')

    await page
      .elementLocator(header)
      .getByRole('button', {name: 'Toggle Sidebar'})
      .click()

    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)
    expect(layoutUpdates(main)).toEqual([
      {type: 'layout.update', changes: {sidebarOpen: false}},
    ])
  })

  it('closes at once, then opens again when main refuses to save it', async () => {
    const main = fakeMain()
    const refusal = Promise.withResolvers<CommandOutcome<'layout.update'>>()

    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) =>
        command.type === 'layout.update'
          ? refusal.promise
          : main.send(command)) as Bridge['send'],
    }
    await renderApp()
    await expect.poll(sidebarRight).toBeGreaterThan(0)

    await page.getByRole('button', {name: 'Toggle Sidebar'}).click()
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)

    refusal.resolve({
      ok: false,
      error: {code: 'handler-failed', message: 'The disk is full.'},
    })
    await expect.poll(sidebarRight).toBeGreaterThan(0)
  })

  it('starts closed when main saved it closed, without showing it open first, then follows main', async () => {
    const widths = watchCanvasWidths()
    const main = fakeMain({layout: {sidebarOpen: false}})
    globalThis.window.uz = main
    await renderApp()

    await expect
      .element(page.getByRole('main').getByText('Start a new Tree'))
      .toBeVisible()
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)
    await expect.poll(canvasWidth).toBe(globalThis.innerWidth)
    await expect.poll(() => widths.length).toBeGreaterThan(0)
    expect(widths.filter(width => width !== globalThis.innerWidth)).toEqual([])

    main.publish({
      type: 'LAYOUT_CHANGED',
      layout: {...DEFAULT_LAYOUT, sidebarOpen: true},
    })
    await expect.poll(sidebarRight).toBeGreaterThan(0)
  })

  it('keeps a closed sidebar’s Trees out of the keyboard’s reach, and lets them back once it opens', async () => {
    const main = fakeMain({
      trees: [savedTree({title: 'Draft'})],
      layout: {sidebarOpen: false},
    })

    globalThis.window.uz = main
    await renderApp()
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)

    const row = page
      .getByRole('button', {name: 'Draft', includeHidden: true})
      .element()

    if (!(row instanceof HTMLElement)) throw new Error('No Tree row')

    row.focus()
    expect(document.activeElement).not.toBe(row)

    main.publish({
      type: 'LAYOUT_CHANGED',
      layout: {...DEFAULT_LAYOUT, sidebarOpen: true},
    })
    await expect.poll(sidebarRight).toBeGreaterThan(0)
    row.focus()
    expect(document.activeElement).toBe(row)
  })
})

function noTreeOpen() {
  return page.getByRole('main')
}

function heldTreeList(main: FakeMain) {
  const list = Promise.withResolvers<CommandOutcome<'tree.list'>>()

  globalThis.window.uz = {
    ...main,
    send: (async (command: Command) =>
      command.type === 'tree.list'
        ? list.promise
        : main.send(command)) as Bridge['send'],
  }

  return list
}

async function expectNoWordAboutTrees() {
  await expect
    .element(
      page.getByRole('main').getByRole('button', {name: 'Toggle Sidebar'})
    )
    .toBeVisible()

  expect(page.getByText('Start a new Tree').elements()).toEqual([])
  expect(page.getByText('No Tree open').elements()).toEqual([])
}

describe('with no Tree open', () => {
  const draft = savedTree({title: 'Draft'})

  it('says no Tree is open when there are Trees, and starts a new one from the main area', async () => {
    const main = fakeMain({trees: [draft]})
    globalThis.window.uz = main
    await renderApp()

    await expect
      .element(
        noTreeOpen().getByText(
          'Pick a Tree from the sidebar, or start a new one.'
        )
      )
      .toBeVisible()
    await expect.element(noTreeOpen().getByText('No Tree open')).toBeVisible()
    await noTreeOpen().getByRole('button', {name: 'New Tree'}).click()

    await expect
      .element(page.getByRole('heading', {name: 'Untitled Tree'}))
      .toBeVisible()
    expect(main.sent).toContainEqual({type: 'tree.create'})
  })

  it('offers Show Trees only while the sidebar is closed, and it opens the sidebar and saves it open', async () => {
    const main = fakeMain({trees: [draft], layout: {sidebarOpen: false}})
    globalThis.window.uz = main
    await renderApp()
    await expect.poll(sidebarRight).toBeLessThanOrEqual(0)

    await noTreeOpen().getByRole('button', {name: 'Show Trees'}).click()

    await expect.poll(sidebarRight).toBeGreaterThan(0)
    expect(main.sent).toContainEqual({
      type: 'layout.update',
      changes: {sidebarOpen: true},
    })
    await expect
      .element(noTreeOpen().getByRole('button', {name: 'Show Trees'}))
      .not.toBeInTheDocument()
  })

  it('says nothing about Trees until main lists them, then says no Tree is open', async () => {
    const list = heldTreeList(fakeMain())
    await renderApp()

    await expectNoWordAboutTrees()

    list.resolve({ok: true, value: {trees: [draft]}})
    await expect.element(noTreeOpen().getByText('No Tree open')).toBeVisible()
  })

  it('says nothing about Trees when main cannot list them, and still starts a new one from the sidebar', async () => {
    const list = heldTreeList(fakeMain())
    await renderApp()

    list.resolve({
      ok: false,
      error: {code: 'handler-failed', message: 'The disk is full.'},
    })
    await expect.element(page.getByText('The disk is full.')).toBeVisible()
    await expectNoWordAboutTrees()

    await sidebarNewTree().click()
    await expect
      .element(page.getByRole('heading', {name: 'Untitled Tree'}))
      .toBeVisible()
  })

  it('invites a first Tree, with no Show Trees, when there are none', async () => {
    globalThis.window.uz = fakeMain({layout: {sidebarOpen: false}})
    await renderApp()

    await expect
      .element(
        noTreeOpen().getByText(
          'One conversation that can branch in any direction.'
        )
      )
      .toBeVisible()
    await expect
      .element(noTreeOpen().getByRole('button', {name: 'Show Trees'}))
      .not.toBeInTheDocument()
  })
})

describe('connecting a Provider', () => {
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

  it('starts on the Connections screen until a Provider is connected', async () => {
    globalThis.window.uz = fakeMain({firstLaunch: true})
    await renderApp()

    await expect
      .element(
        page.getByRole('heading', {name: 'Connect the AI you already pay for'})
      )
      .toBeVisible()
    await expect
      .element(page.getByText('Pro or Max · by Anthropic'))
      .toBeVisible()
    await expect.element(page.getByText('Any plan · by OpenAI')).toBeVisible()
    await expect
      .element(page.getByRole('button', {name: 'Start chatting →'}))
      .toBeDisabled()
    await expect
      .element(page.getByRole('region', {name: 'Trees'}))
      .not.toBeInTheDocument()
  })

  it('walks Claude’s card through every step, then starts chatting', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await renderApp()

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    expect(main.sent.at(-1)).toEqual({
      type: 'provider.connect',
      provider: 'claude',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'get-ready',
      progress: {receivedBytes: 24_000_000, totalBytes: 100_000_000},
    })
    await expect
      .element(claudeCard().getByText('Getting Claude ready… 24 of 100 MB'))
      .toBeVisible()
    await expect
      .element(page.getByRole('button', {name: 'Connect ChatGPT'}))
      .toBeDisabled()
    await expect
      .element(page.getByText('You can connect ChatGPT once Claude is done.'))
      .toBeVisible()

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'sign-in-page',
      url,
    })
    await expect
      .element(
        claudeCard().getByText(
          'Claude’s page may say “Claude Code”. That’s normal.'
        )
      )
      .toBeVisible()
    await claudeCard()
      .getByRole('button', {name: 'Don’t see the page? Open it again'})
      .click()
    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.open-page',
      provider: 'claude',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
    })
    await claudeCard().getByRole('textbox', {name: 'Code'}).fill('typo')
    await claudeCard()
      .getByRole('button', {name: 'Connect', exact: true})
      .click()
    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.code',
      provider: 'claude',
      code: 'typo',
    })

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
      wrongCode: true,
    })
    await expect
      .element(
        claudeCard().getByText(
          'That code didn’t work. Copy it again from Claude’s page.'
        )
      )
      .toBeVisible()

    main.publish({type: 'SIGN_IN_STEP', provider: 'claude', step: 'check-plan'})
    await expect
      .element(claudeCard().getByText('Checking your plan…'))
      .toBeVisible()

    main.publish({
      type: 'SIGN_IN_FINISHED',
      provider: 'claude',
      outcome: 'connected',
      account,
    })
    main.publish({
      type: 'PROVIDER_STATUS',
      provider: 'claude',
      status: 'ready',
      account,
    })
    await expect.element(claudeCard().getByText('Connected')).toBeVisible()
    await expect
      .element(claudeCard().getByText('sam@example.com'))
      .toBeVisible()
    await expect.element(claudeCard().getByText('Claude Max')).toBeVisible()

    await page.getByRole('button', {name: 'Start chatting →'}).click()
    await expect
      .element(page.getByRole('textbox', {name: 'Prompt'}))
      .toBeVisible()
    expect(main.sent.map(command => command.type)).toContain('tree.create')
  })

  it('waits for the new page after Claude refuses a code', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await renderApp()

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      wrongCode: true,
    })
    await claudeCard().getByRole('textbox', {name: 'Code'}).fill('another')

    await expect
      .element(claudeCard().getByRole('button', {name: 'Connect', exact: true}))
      .toBeDisabled()
    await expect
      .element(
        claudeCard().getByRole('button', {
          name: 'Don’t see the page? Open it again',
        })
      )
      .not.toBeInTheDocument()

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'claude',
      step: 'paste-code',
      url,
      wrongCode: true,
    })
    await expect
      .element(claudeCard().getByRole('button', {name: 'Connect', exact: true}))
      .toBeEnabled()
  })

  it('cancels connecting from the card', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await renderApp()

    await page.getByRole('button', {name: 'Connect Claude'}).click()
    main.publish({type: 'SIGN_IN_STEP', provider: 'claude', step: 'get-ready'})
    await claudeCard().getByRole('button', {name: 'Cancel'}).click()

    expect(main.sent.at(-1)).toEqual({
      type: 'sign-in.cancel',
      provider: 'claude',
    })
  })

  it('shows each failure in plain words with one action', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await renderApp()

    const failures = [
      {
        reason: 'download-failed',
        line: 'Couldn’t get Claude ready. Check your internet connection and try again.',
        action: 'Try again',
      },
      {
        reason: 'no-answer',
        line: 'Sign-in didn’t finish on Claude’s page. Try again.',
        action: 'Try again',
      },
      {
        reason: 'plan-refused',
        line: 'Unimatrix Zero needs Claude Pro or Max.',
        action: 'Use a different account',
      },
    ] as const

    for (const {reason, line, action} of failures) {
      main.publish({
        type: 'SIGN_IN_STEP',
        provider: 'claude',
        step: 'check-plan',
      })
      main.publish({
        type: 'SIGN_IN_FINISHED',
        provider: 'claude',
        outcome: 'failed',
        failure: {reason, message: 'from the host'},
      })

      await expect
        .element(claudeCard().getByRole('alert'))
        .toHaveTextContent(line)
      main.sent.length = 0
      await claudeCard().getByRole('button', {name: action}).click()
      expect(main.sent).toEqual([
        {type: 'provider.connect', provider: 'claude'},
      ])
    }
  })

  it('says why Codex refused a ChatGPT account, with a different account to try', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = main
    await renderApp()

    main.publish({
      type: 'SIGN_IN_STEP',
      provider: 'chatgpt',
      step: 'sign-in-page',
      url: 'https://auth.openai.com/oauth/authorize',
    })
    main.publish({
      type: 'SIGN_IN_FINISHED',
      provider: 'chatgpt',
      outcome: 'failed',
      failure: {
        reason: 'plan-refused',
        message: 'Codex is not enabled for your workspace.',
      },
    })

    await expect
      .element(chatgptCard().getByRole('alert'))
      .toHaveTextContent(
        'Codex isn’t turned on for this ChatGPT workspace. Ask its admin, or use a different account.'
      )
    await expect
      .element(
        chatgptCard().getByRole('button', {name: 'Use a different account'})
      )
      .toBeVisible()
  })

  it('shows why main refused to connect', async () => {
    const main = fakeMain({firstLaunch: true})
    globalThis.window.uz = {
      ...main,
      send: (async (command: Command) =>
        command.type === 'provider.connect'
          ? {
              ok: false,
              error: {
                code: 'handler-failed',
                message: 'ChatGPT can’t be connected in this version yet.',
              },
            }
          : main.send(command)) as Bridge['send'],
    }
    await renderApp()

    await page.getByRole('button', {name: 'Connect ChatGPT'}).click()

    await expect
      .element(page.getByRole('region', {name: 'ChatGPT'}).getByRole('alert'))
      .toHaveTextContent('ChatGPT can’t be connected in this version yet.')
  })

  it('shows the same cards under Settings once connected, with no Connections button left in the sidebar', async () => {
    globalThis.window.uz = fakeMain()
    await renderApp()

    await page.getByRole('button', {name: 'Settings'}).click()
    await page
      .getByRole('navigation', {name: 'Settings sections'})
      .getByRole('button', {name: 'Connections'})
      .click()

    const connections = page.getByRole('region', {name: 'Connections'})

    await expect
      .element(connections.getByRole('heading', {name: 'Connections'}))
      .toBeVisible()
    await expect
      .element(
        connections
          .getByRole('region', {name: 'Claude'})
          .getByText('sam@example.com')
      )
      .toBeVisible()
    await expect
      .element(connections.getByRole('button', {name: 'Connect ChatGPT'}))
      .toBeEnabled()
  })
})
