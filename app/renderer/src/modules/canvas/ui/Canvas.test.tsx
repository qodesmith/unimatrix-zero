// The Playwright provider gives `cdp()` its `send`.
/// <reference types="@vitest/browser-playwright" />
import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {SettingsProvider} from '#modules/settings/main'
import {LiveReplies} from '#modules/turns/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it, onTestFinished} from 'vitest'
import {render} from 'vitest-browser-react'
import {cdp, page, userEvent} from 'vitest/browser'

import {Canvas} from './Canvas'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'

let clock = 0

function at(step: number) {
  return new Date(Date.UTC(2026, 9, 19, 12, 0, step)).toISOString()
}

function uuid(n: number) {
  return `01a16096-00ad-7d3b-8205-${String(n).padStart(12, '0')}`
}

interface Saved {
  prompts: Prompt[]
  replies: Reply[]
  settings?: Partial<Settings>
}

function prompt(n: number, parent: number | null, text: string): Prompt {
  return {
    id: uuid(n),
    treeId,
    parentReplyId: parent === null ? null : uuid(parent),
    text,
    createdAt: at(++clock),
  }
}

function reply(n: number, promptN: number, text: string): Reply {
  return {
    id: uuid(n),
    treeId,
    promptId: uuid(promptN),
    provider: 'claude',
    model: 'fake',
    status: 'complete',
    content: [{type: 'text', text}],
    contextSize: null,
    contextWindow: null,
    createdAt: at(++clock),
  }
}

/**
 * A Tree with two Forks, each Turn's text naming it:
 *
 * ```text
 * P1 - R1 - P2 - R2 - P4 - R4
 *         |         - P5 - R5
 *         - P3 - R3
 * ```
 */
function forkedTree(): Saved {
  clock = 0

  return {
    prompts: [
      prompt(1, null, 'Prompt one'),
      prompt(2, 11, 'Prompt two'),
      prompt(3, 11, 'Prompt three'),
      prompt(4, 12, 'Prompt four'),
      prompt(5, 12, 'Prompt five'),
    ],
    replies: [
      reply(11, 1, 'Reply one'),
      reply(12, 2, 'Reply two'),
      reply(13, 3, 'Reply three'),
      reply(14, 4, 'Reply four'),
      reply(15, 5, 'Reply five'),
    ],
  }
}

/** Main as the canvas sees it. */
function fakeMain(saved: Saved) {
  const prompts = [...saved.prompts]
  const replies = [...saved.replies]
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved.settings}
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'tree.turns') {
        return {ok: true, value: {prompts: [...prompts], replies: [...replies]}}
      }

      if (command.type === 'settings.update') {
        Object.assign(settings, command.changes)
        publish({type: 'SETTINGS_CHANGED', settings: {...settings}})

        return {ok: true, value: {...settings}}
      }

      if (command.type === 'prompt.send') {
        const sentPrompt: Prompt = {
          id: crypto.randomUUID(),
          treeId,
          parentReplyId: command.parentReplyId,
          text: command.text,
          createdAt,
        }

        const started: Reply = {
          ...reply(0, 0, ''),
          id: crypto.randomUUID(),
          promptId: sentPrompt.id,
          status: 'streaming',
          content: [],
          createdAt,
        }

        prompts.push(sentPrompt)
        replies.push(started)

        return {ok: true, value: {prompt: sentPrompt, reply: started}}
      }

      return {ok: false, error: {code: 'not-found', message: 'Not here'}}
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers: [],
        signIn: null,
        settings: {...settings},
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent, publish, replies}
}

function Providers({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SettingsProvider>
        <LiveReplies>
          <div style={{height: '100vh'}}>{children}</div>
        </LiveReplies>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

async function renderCanvas(saved: Saved) {
  const main = fakeMain(saved)
  globalThis.window.uz = main
  const screen = await render(<Canvas treeId={treeId} />, {wrapper: Providers})

  return {main, screen}
}

/** The ids of the connections drawn on the highlighted Thread. */
function highlightedEdges() {
  return [...document.querySelectorAll('.react-flow__edge.on-thread')]
    .map(drawn => drawn.getAttribute('data-id'))
    .toSorted((a, b) => (a ?? '').localeCompare(b ?? ''))
}

function edge(source: number, target: number) {
  return `${uuid(source)}-${uuid(target)}`
}

/** Where the canvas is panned to, as React Flow writes it. */
function viewport() {
  return (
    document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? ''
  )
}

/** The canvas's zoom, as React Flow writes it. */
function zoomOf() {
  const scale = /scale\(([\d.]+)\)/.exec(viewport())?.[1]

  return scale === undefined ? Number.NaN : Number(scale)
}

/** The viewport once it has stopped moving: the same two reads 100ms apart. */
async function settledViewport() {
  let last: string | null = null

  await expect
    .poll(
      () => {
        const now = viewport()
        const same = now === last
        last = now

        return same
      },
      {interval: 100}
    )
    .toBe(true)

  return last
}

/** Pointer off every Turn. */
async function hoverAway() {
  await page.getByRole('group', {name: 'Orientation'}).hover()
}

/** The canvas itself, leaving out the slideout drawn over it. */
function canvas() {
  const flow = document.querySelector('.react-flow')

  if (!flow) throw new Error('The canvas is not drawn')

  return page.elementLocator(flow)
}

/** The box a Turn is drawn in. */
function nodeOf(turnText: string) {
  const box = canvas()
    .getByText(turnText)
    .element()
    .closest('.react-flow__node')

  if (!box) throw new Error(`${turnText} is not on the canvas`)

  return page.elementLocator(box)
}

/** The Input under a Reply's box. */
function inputUnder(replyText: string) {
  return nodeOf(replyText).getByRole('textbox', {name: 'Prompt'})
}

/** Whether a Reply's Input is shown, as the canvas marks it. */
function revealed(replyText: string) {
  return inputUnder(replyText)
    .element()
    .closest('[data-revealed]')
    ?.getAttribute('data-revealed')
}

it('draws every Turn as its own box, top-down, with an Input under every Reply', async () => {
  await renderCanvas(forkedTree())

  await expect.element(page.getByText('Prompt three')).toBeVisible()
  expect(document.querySelectorAll('.react-flow__node-prompt')).toHaveLength(5)
  expect(document.querySelectorAll('.react-flow__node-reply')).toHaveLength(5)
  expect(document.querySelectorAll('.react-flow__node').length).toBe(10)
  await expect
    .element(page.getByRole('textbox', {name: 'Prompt'}).first())
    .toBeVisible()
  expect(document.querySelectorAll('textarea')).toHaveLength(5)

  const three = page.getByText('Prompt three').element().getBoundingClientRect()
  const two = page.getByText('Prompt two').element().getBoundingClientRect()
  const one = page.getByText('Prompt one').element().getBoundingClientRect()

  expect(two.top).toBeGreaterThan(one.bottom)
  expect(two.top).toBe(three.top)
  expect(two.left).toBeLessThan(three.left)
})

it('shows the Active Thread’s Input, reveals another Reply’s on hover, and keeps one holding a draft', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()

  expect(document.querySelectorAll('textarea')).toHaveLength(5)
  await expect.poll(() => revealed('Reply five')).toBe('true')
  expect(revealed('Reply one')).toBe('false')
  expect(revealed('Reply three')).toBe('false')

  await page.getByText('Reply three').hover()
  await expect.poll(() => revealed('Reply three')).toBe('true')
  await hoverAway()
  await expect.poll(() => revealed('Reply three')).toBe('false')

  await inputUnder('Reply one').fill('A draft')
  await inputUnder('Reply five').click()
  await hoverAway()
  await expect.poll(() => revealed('Reply five')).toBe('true')
  expect(revealed('Reply one')).toBe('true')
  expect(revealed('Reply three')).toBe('false')
})

it('keeps a draft through its Fork folding and unfolding, and through an orientation switch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await inputUnder('Reply four').fill('Half a thought')
  await hoverAway()

  const pill = nodeOf('Reply two').getByRole('button', {
    name: 'Fork · 2 Branches',
  })

  await pill.click()
  await expect.element(page.getByText('Reply four')).not.toBeInTheDocument()
  await pill.click()
  await expect.element(page.getByText('Reply four')).toBeVisible()
  await expect.element(inputUnder('Reply four')).toHaveValue('Half a thought')
  await expect.poll(() => revealed('Reply four')).toBe('true')

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(5)
  await expect.element(inputUnder('Reply four')).toHaveValue('Half a thought')
  await expect.poll(() => revealed('Reply four')).toBe('true')
})

it('highlights the newest Thread until the user picks another by focusing its Input', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()

  await expect
    .poll(highlightedEdges)
    .toEqual(
      [
        edge(1, 11),
        edge(11, 2),
        edge(2, 12),
        edge(12, 5),
        edge(5, 15),
      ].toSorted()
    )

  await inputUnder('Reply three').click()
  await hoverAway()

  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 3), edge(3, 13)].toSorted())
})

it('highlights a hovered Turn’s Thread only while the pointer is on it, even over the focused Input’s', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply four')).toBeVisible()

  await page.getByText('Prompt four').hover()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 2), edge(2, 12), edge(12, 4)].toSorted())

  await inputUnder('Reply three').fill('A thought')
  await page.getByText('Prompt four').hover()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 2), edge(2, 12), edge(12, 4)].toSorted())

  await hoverAway()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 3), edge(3, 13)].toSorted())
})

it('moves the highlight to the Reply a leaf Input sends for, and keeps hovering alive', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply three')).toBeVisible()

  await inputUnder('Reply three').fill('A thought')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('A thought')).toBeVisible()
  await hoverAway()

  const sentPromptId = page
    .getByText('A thought')
    .element()
    .closest('.react-flow__node')
    ?.getAttribute('data-id')

  if (!sentPromptId) throw new Error('The sent Prompt is not on the canvas')

  await expect
    .poll(highlightedEdges)
    .toEqual(
      expect.arrayContaining([
        edge(1, 11),
        edge(11, 3),
        edge(3, 13),
        `${uuid(13)}-${sentPromptId}`,
      ])
    )
  expect(highlightedEdges()).toHaveLength(5)

  await page.getByText('Prompt four').hover()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 2), edge(2, 12), edge(12, 4)].toSorted())
})

/** Where a Turn's text is drawn. */
function rect(turnText: string) {
  return page.getByText(turnText).element().getBoundingClientRect()
}

it('branches: a Prompt sent into an answered Reply lands beside the old Branches', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply three')).toBeVisible()

  await inputUnder('Reply one').fill('Another way')
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText('Another way')).toBeVisible()

  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: uuid(11), text: 'Another way'}),
  ])
  await expect
    .poll(() => {
      const row = [
        rect('Another way'),
        rect('Prompt two'),
        rect('Prompt three'),
      ]

      const lefts = row.map(box => box.left).toSorted((a, b) => a - b)

      return (
        row.every(box => box.top === row[0]?.top) &&
        lefts.every((left, i) => i === 0 || left - (lefts[i - 1] ?? 0) >= 440)
      )
    })
    .toBe(true)
})

/** One Thread: `P1 - R1 - P2 - R2`. */
function linearTree(): Saved {
  clock = 0

  return {
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    replies: [reply(11, 1, 'Reply one'), reply(12, 2, 'Reply two')],
  }
}

async function sendInto(replyText: string, text: string) {
  await inputUnder(replyText).fill(text)
  await userEvent.keyboard('{Enter}')
  await expect.element(page.getByText(text)).toBeVisible()
}

it('zooms out just enough to show the whole Tree on its first Fork, and keeps the zoom on every other send', async () => {
  await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()
  // Fitting the Tree on load moves it off the origin.
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  // Zoomed in, two Branches side by side no longer fit the window.
  const loaded = zoomOf()
  await page.getByRole('button', {name: 'Zoom in'}).click()
  await expect.poll(zoomOf).toBeGreaterThan(loaded * 1.1)
  const zoomedIn = await settledViewport()
  const zoom = zoomOf()

  await sendInto('Reply two', 'Carry on')
  await expect.poll(viewport).not.toBe(zoomedIn)
  const continued = await settledViewport()
  expect(zoomOf()).toBe(zoom)

  await sendInto('Reply one', 'Another way')
  await expect.poll(viewport).not.toBe(continued)
  const forked = await settledViewport()
  expect(zoomOf()).toBeLessThan(zoom)
  const fitted = zoomOf()

  await sendInto('Reply two', 'Yet another')
  await expect.poll(viewport).not.toBe(forked)
  await settledViewport()
  expect(zoomOf()).toBe(fitted)
})

function nodeCount() {
  return document.querySelectorAll('.react-flow__node').length
}

it('folds a Fork’s Branches through its pill and unfolds them again, with the Reply staying put', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const pill = nodeOf('Reply two').getByRole('button', {
    name: 'Fork · 2 Branches',
  })

  await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
  const before = rect('Reply two')

  await pill.click()
  await expect.element(page.getByText('Prompt four')).not.toBeInTheDocument()
  expect(page.getByText('Reply five').query()).toBeNull()
  expect(nodeCount()).toBe(6)
  await expect.element(pill).toHaveAttribute('aria-expanded', 'false')
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)

  await pill.click()
  await expect.element(page.getByText('Prompt four')).toBeVisible()
  expect(nodeCount()).toBe(10)
  await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)
})

it('folds a Fork’s Branches in the horizontal orientation too, its card staying put', async () => {
  await renderCanvas({
    ...forkedTree(),
    settings: {canvasOrientation: 'horizontal'},
  })

  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const pill = nodeOf('Reply two').getByRole('button', {
    name: 'Fork · 2 Branches',
  })

  const before = rect('Reply two')

  await pill.click()
  await expect.element(page.getByText('Prompt four')).not.toBeInTheDocument()
  expect(nodeCount()).toBe(3)
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)
})

it('unfolds a folded Fork to jump to a Reply streaming in one of its Branches', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(15) ? {...one, status: 'streaming', content: []} : one
  )

  await renderCanvas(saved)
  await expect.element(page.getByText('Prompt five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')

  const pill = nodeOf('Reply two').getByRole('button', {
    name: 'Fork · 2 Branches',
  })

  await pill.click()
  await expect.element(page.getByText('Prompt five')).not.toBeInTheDocument()
  const folded = await settledViewport()

  await page.getByRole('status').getByText('1 streaming').click()
  await expect.element(page.getByText('Prompt five')).toBeVisible()
  await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(viewport).not.toBe(folded)
})

it('unfolds a folded Fork when a Prompt is sent into it, showing the new Branch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await nodeOf('Reply two')
    .getByRole('button', {name: 'Fork · 2 Branches'})
    .click()
  await expect.element(page.getByText('Prompt four')).not.toBeInTheDocument()

  await sendInto('Reply two', 'A third way')
  await expect.element(page.getByText('Prompt four')).toBeVisible()
  await expect
    .element(
      nodeOf('Reply two').getByRole('button', {name: 'Fork · 3 Branches'})
    )
    .toHaveAttribute('aria-expanded', 'true')
})

it('keeps a Fork’s card put on unfolding Branches folded since before an orientation switch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')

  // Reply five, the newest, ends the Active Thread: the switch has it to pan to
  // but folded away, and the unfolded cards are measured only once they show.
  await nodeOf('Reply two')
    .getByRole('button', {name: 'Fork · 2 Branches'})
    .click()
  await expect.element(page.getByText('Reply five')).not.toBeInTheDocument()

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(3)
  await expect
    .poll(() => document.querySelector('.canvas-switching'))
    .toBeNull()
  await settledViewport()
  const before = rect('Reply two')

  await nodeOf('Reply two')
    .getByRole('button', {name: 'Fork · 2 Branches'})
    .click()
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)
})

it('shows no pill on a Reply the conversation simply continues from', async () => {
  await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()

  expect(page.getByRole('button', {name: /Fork/}).query()).toBeNull()
})

it('switches to one card per Exchange, left to right, and writes the Setting', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await page.getByRole('button', {name: 'Horizontal'}).click()

  expect(main.sent.at(-1)).toEqual({
    type: 'settings.update',
    changes: {canvasOrientation: 'horizontal'},
  })
  await expect
    .element(page.getByRole('button', {name: 'Horizontal'}))
    .toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(5)
  expect(document.querySelectorAll('.react-flow__node-reply')).toHaveLength(0)

  await expect
    .poll(() => {
      const one = page.getByText('Prompt one').element().getBoundingClientRect()
      const two = page.getByText('Prompt two').element().getBoundingClientRect()

      const three = page
        .getByText('Prompt three')
        .element()
        .getBoundingClientRect()

      return (
        two.left > one.right && two.left === three.left && two.top < three.top
      )
    })
    .toBe(true)
})

it('opens with the orientation the Setting says', async () => {
  await renderCanvas({
    ...forkedTree(),
    settings: {canvasOrientation: 'horizontal'},
  })

  await expect.element(page.getByText('Reply five')).toBeVisible()
  expect(document.querySelectorAll('.react-flow__node-exchange')).toHaveLength(
    5
  )
})

const longText = Array.from({length: 40}, (_, i) => `Line ${i + 1}`).join('\n')

/** The root Prompt as drawn, the first Turn on the canvas. */
function rootPrompt() {
  return document.querySelector(`[data-turn="${uuid(1)}"]`)
}

function rootPromptHeight() {
  return rootPrompt()?.getBoundingClientRect().height ?? 0
}

it('caps a long Prompt, with Show more letting it out and Show less capping it again', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, longText)],
    replies: [reply(11, 1, 'Short')],
  })

  const more = page.getByRole('button', {name: 'Show more'})
  await expect.element(more).toBeVisible()
  expect(rootPrompt()?.textContent).toContain('Line 40')
  const capped = rootPromptHeight()

  await more.click()
  await expect
    .element(page.getByRole('button', {name: 'Show less'}))
    .toBeVisible()
  expect(rootPromptHeight()).toBeGreaterThan(capped + 200)

  await page.getByRole('button', {name: 'Show less'}).click()
  await expect
    .element(page.getByRole('button', {name: 'Show more'}))
    .toBeVisible()
})

it('keeps a Reply let out by Show more open across an orientation switch', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Short')],
    // Markdown folds single newlines into one paragraph.
    replies: [reply(11, 1, longText.replaceAll('\n', '\n\n'))],
  })

  await page.getByRole('button', {name: 'Show more'}).click()
  await expect
    .element(page.getByRole('button', {name: 'Show less'}))
    .toBeVisible()

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(1)

  await expect
    .element(page.getByRole('button', {name: 'Show less'}))
    .toBeVisible()
  expect(page.getByRole('button', {name: 'Show more'}).query()).toBeNull()
})

it('lets long Turns take their full height when the Setting is off', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, longText)],
    replies: [reply(11, 1, 'Short')],
    settings: {limitTurnHeight: false},
  })

  await expect.element(page.getByText('Short')).toBeVisible()
  expect(rootPrompt()?.textContent).toContain('Line 40')
  expect(rootPromptHeight()).toBeGreaterThan(500)
  await expect
    .element(page.getByRole('button', {name: 'Show more'}))
    .not.toBeInTheDocument()
})

it('shows each Reply’s Context size, what its Exchange added on hover, and the meter toward the Context window', async () => {
  clock = 0

  const first = {
    ...reply(11, 1, 'Reply one'),
    contextSize: 10_000,
    contextWindow: 200_000,
  }

  const second = {
    ...reply(12, 2, 'Reply two'),
    contextSize: 12_300,
    contextWindow: 200_000,
  }

  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    replies: [first, second],
  })

  const badge = page.getByText('12.3k ctx')
  await expect.element(badge).toBeVisible()
  await badge.hover()
  await expect
    .element(
      page.getByRole('tooltip').filter({hasText: 'This Exchange: +2.3k'})
    )
    .toBeVisible()
  await expect
    .element(
      page.getByRole('tooltip').filter({hasText: 'Thread up to here: 12.3k'})
    )
    .toBeVisible()

  const meters = page.getByRole('meter', {
    name: 'Context size toward the Context window',
  })

  await expect.element(meters.nth(1)).toHaveAttribute('aria-valuenow', '12300')
  await expect.element(meters.nth(1)).toHaveAttribute('aria-valuemax', '200000')
})

it('leaves the meter out when the Setting is off', async () => {
  clock = 0

  const only = {
    ...reply(11, 1, 'Reply one'),
    contextSize: 10_000,
    contextWindow: 200_000,
  }

  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one')],
    replies: [only],
    settings: {contextSizeMeter: false},
  })

  await expect.element(page.getByText('10.0k ctx')).toBeVisible()
  await expect.element(page.getByRole('meter')).not.toBeInTheDocument()
})

it('counts the Replies being written and the failed ones, and jumps to them', async () => {
  clock = 0

  const streaming = {
    ...reply(12, 2, ''),
    status: 'streaming' as const,
    content: [],
  }

  const failed = {...reply(13, 3, 'Cut off'), status: 'failed' as const}

  await renderCanvas({
    prompts: [
      prompt(1, null, 'Prompt one'),
      prompt(2, 11, 'Prompt two'),
      prompt(3, 11, 'Prompt three'),
    ],
    replies: [reply(11, 1, 'Reply one'), streaming, failed],
  })

  const status = page.getByRole('status')
  await expect.element(status.getByText('1 streaming')).toBeVisible()
  await expect.element(status.getByText('1 failed')).toBeVisible()
  expect(document.querySelectorAll('textarea')).toHaveLength(2)

  await expect.poll(viewport).toContain('translate')
  const before = viewport()

  await status.getByText('1 failed').click()
  await expect.poll(viewport).not.toBe(before)
})

it('counts the Replies streaming on several Threads at once and jumps to each in turn', async () => {
  clock = 0

  function streaming(n: number, promptN: number): Reply {
    return {...reply(n, promptN, ''), status: 'streaming', content: []}
  }

  await renderCanvas({
    prompts: [
      prompt(1, null, 'Prompt one'),
      prompt(2, 11, 'Prompt two'),
      prompt(3, 11, 'Prompt three'),
    ],
    replies: [reply(11, 1, 'Reply one'), streaming(12, 2), streaming(13, 3)],
  })

  const status = page.getByRole('status')
  await expect.element(status.getByText('2 streaming')).toBeVisible()
  await expect.poll(viewport).toContain('translate')
  await settledViewport()
  const start = viewport()

  await status.getByText('2 streaming').click()
  await expect.poll(viewport).not.toBe(start)
  await settledViewport()
  const first = viewport()

  await status.getByText('2 streaming').click()
  await expect.poll(viewport).not.toBe(first)
})

it('shows one centered Input on an empty Tree and the Turns once it is sent', async () => {
  const {main} = await renderCanvas({prompts: [], replies: []})

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')

  await expect.element(page.getByText('Hello?')).toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: null, text: 'Hello?'}),
  ])
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node').length)
    .toBe(2)
})

function slideout() {
  return page.getByRole('complementary', {name: 'Chat'})
}

/** The Turn texts the slideout shows, top to bottom. */
function chatTurns() {
  return [...slideout().element().querySelectorAll('[data-chat-turn]')].map(
    turn => turn.textContent.trim()
  )
}

/** The connections from the root down to Reply four. */
function threadToReplyFour() {
  return [
    edge(1, 11),
    edge(11, 2),
    edge(2, 12),
    edge(12, 4),
    edge(4, 14),
  ].toSorted()
}

function slideoutWidth() {
  return slideout().element().getBoundingClientRect().width
}

it('opens the slideout on a clicked Turn’s Thread, with one Input at its end and that Thread highlighted', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await canvas().getByText('Prompt four').click()
  await expect.element(slideout()).toBeVisible()

  expect(chatTurns()).toEqual([
    'Prompt one',
    'Reply one',
    'Prompt two',
    'Reply two',
    'Prompt four',
    'Reply four',
  ])
  expect(
    slideout().getByRole('textbox', {name: 'Prompt'}).elements()
  ).toHaveLength(1)

  await hoverAway()
  await expect.poll(highlightedEdges).toEqual(threadToReplyFour())
})

it('switches the slideout to another clicked Turn’s Thread, and closes it when a canvas Input takes focus', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  // The slideout covers the right of the canvas: the Branch on the left stays clickable.
  await canvas().getByText('Reply three').click()
  await expect
    .poll(chatTurns)
    .toEqual(['Prompt one', 'Reply one', 'Prompt three', 'Reply three'])
  await canvas().getByText('Prompt four').click()

  await expect
    .poll(chatTurns)
    .toEqual([
      'Prompt one',
      'Reply one',
      'Prompt two',
      'Reply two',
      'Prompt four',
      'Reply four',
    ])
  await hoverAway()
  await expect.poll(highlightedEdges).toEqual(threadToReplyFour())

  await inputUnder('Reply two').click()
  await expect.element(slideout()).not.toBeInTheDocument()
  await hoverAway()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 2), edge(2, 12)].toSorted())
})

it('branches from the slideout into a Reply that already has a response, and follows the new Branch', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await canvas().getByText('Prompt one').click()
  await expect.poll(chatTurns).toEqual(['Prompt one', 'Reply one'])

  await slideout().getByRole('textbox', {name: 'Prompt'}).fill('A third way')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(
      nodeOf('Reply one').getByRole('button', {name: 'Fork · 3 Branches'})
    )
    .toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: uuid(11), text: 'A third way'}),
  ])

  await expect
    .poll(chatTurns)
    .toEqual(['Prompt one', 'Reply one', 'A third way', 'Writing…'])
  expect(slideout().getByRole('textbox').query()).toBeNull()

  const sentPromptId = nodeOf('A third way').element().getAttribute('data-id')

  await hoverAway()
  await expect
    .poll(highlightedEdges)
    .toEqual(
      expect.arrayContaining([edge(1, 11), `${uuid(11)}-${sentPromptId}`])
    )
  expect(highlightedEdges()).toHaveLength(3)
})

it('opens nothing on a clicked Prompt with no Reply yet, even once its Reply arrives', async () => {
  clock = 0

  const {main} = await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    replies: [reply(11, 1, 'Reply one')],
  })

  await expect.element(page.getByText('Prompt two')).toBeVisible()

  await canvas().getByText('Prompt two').click()
  await expect.element(slideout()).not.toBeInTheDocument()

  main.replies.push(reply(12, 2, 'Reply two'))
  main.publish({
    type: 'SNAPSHOT',
    app: {version: '0.0.0'},
    replies: [],
    providers: [],
    signIn: null,
    settings: DEFAULT_SETTINGS,
  })
  await expect.element(canvas().getByText('Reply two')).toBeVisible()
  await expect.element(slideout()).not.toBeInTheDocument()
})

/** Whether a transition is moving the slideout across the canvas right now. */
function sliding(aside: Element) {
  return aside
    .getAnimations()
    .some(
      animation =>
        animation instanceof CSSTransition &&
        animation.transitionProperty === 'translate'
    )
}

it('slides the slideout in as it opens and out as it closes', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await canvas().getByText('Prompt four').click()
  await expect.element(slideout()).toBeInTheDocument()
  const aside = slideout().element()
  expect(sliding(aside)).toBe(true)
  await expect.poll(() => sliding(aside)).toBe(false)

  await slideout().getByRole('button', {name: 'Close'}).click()
  expect(aside.isConnected).toBe(true)
  expect(sliding(aside)).toBe(true)
  await expect.poll(() => aside.isConnected).toBe(false)
})

/** The OS's reduced motion setting as Chromium reports it; '' is no preference. */
async function emulateReducedMotion(value: 'reduce' | '') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{name: 'prefers-reduced-motion', value}],
  })
}

it('opens and closes the slideout without sliding when the OS asks for reduced motion', async () => {
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await canvas().getByText('Prompt four').click()
  await expect.element(slideout()).toBeInTheDocument()
  const aside = slideout().element()
  expect(sliding(aside)).toBe(false)

  await slideout().getByRole('button', {name: 'Close'}).click()
  expect(sliding(aside)).toBe(false)
  await expect.poll(() => aside.isConnected).toBe(false)
})

it('zooms and switches orientation without gliding when the OS asks for reduced motion', async () => {
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const loaded = zoomOf()
  await page.getByRole('button', {name: 'Zoom in'}).click()
  expect(zoomOf()).toBeCloseTo(loaded * 1.2, 2)

  await page.getByRole('button', {name: 'Horizontal'}).click()

  const gliding = [...document.querySelectorAll('.react-flow__node')].filter(
    node => node.getAnimations().length > 0
  )

  expect(gliding).toEqual([])
})

it('scrolls the slideout to the clicked Turn, expands to cover the canvas, and closes with Esc or its close control', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    // Long enough below Prompt two for it to reach the top.
    replies: [
      reply(11, 1, longText.replaceAll('\n', '\n\n')),
      reply(12, 2, longText.replaceAll('\n', '\n\n')),
    ],
  })
  await expect.element(page.getByText('Prompt two')).toBeVisible()

  await canvas().getByText('Prompt two').click()
  await expect.element(slideout()).toBeVisible()

  const scroller = slideout().element().querySelector('.overflow-y-auto')
  const turn = slideout().getByText('Prompt two').element()

  if (!scroller) throw new Error('The slideout does not scroll')

  expect(scroller.scrollTop).toBeGreaterThan(0)
  expect(
    turn.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  ).toBeLessThan(40)

  const canvasWidth = canvas().element().getBoundingClientRect().width

  expect(slideoutWidth()).toBeLessThan(canvasWidth / 2)
  await slideout().getByRole('button', {name: 'Full screen'}).click()
  await expect.poll(slideoutWidth).toBe(canvasWidth)
  await slideout().getByRole('button', {name: 'Exit full screen'}).click()
  await expect.poll(slideoutWidth).toBeLessThan(canvasWidth / 2)

  await userEvent.keyboard('{Escape}')
  await expect.element(slideout()).not.toBeInTheDocument()

  await canvas().getByText('Prompt one').click()
  await slideout().getByRole('button', {name: 'Close'}).click()
  await expect.element(slideout()).not.toBeInTheDocument()
})
