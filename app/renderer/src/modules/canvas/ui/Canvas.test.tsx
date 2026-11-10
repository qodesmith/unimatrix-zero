// The Playwright provider gives `cdp()` its `send`.
/// <reference types="@vitest/browser-playwright" />
import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {ProviderStatus} from '@uz/contract/providers'
import type {Settings} from '@uz/contract/settings'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'
import type {Locator} from 'vitest/browser'

import {ConnectionsProvider} from '#modules/connections/main'
import {SettingsProvider} from '#modules/settings/main'
import {LiveReplies} from '#modules/turns/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {useLayoutEffect, useState} from 'react'
import {expect, it, onTestFinished, vi} from 'vitest'
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
    failure: null,
    compacted: false,
    createdAt: at(++clock),
  }
}

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

const PROVIDERS: ProviderStatus[] = [
  {
    provider: 'claude',
    status: 'ready',
    account: {email: 'sam@example.com', plan: 'Max'},
  },
  {provider: 'chatgpt', status: 'not-connected', account: null},
]

function fakeMain(saved: Saved) {
  const prompts = [...saved.prompts]
  const replies = [...saved.replies]
  const settings: Settings = {...DEFAULT_SETTINGS, ...saved.settings}
  const sent: Command[] = []
  const listeners = new Set<(event: AppEvent) => void>()
  const stops = {refusal: null as string | null}
  const deletes = {refusal: null as string | null}
  const turnsLoads = {held: null as Promise<void> | null}
  const sends = {failure: null as Reply['failure']}

  function cutFrom(promptId: string) {
    const promptIds = [promptId]
    const replyIds: string[] = []

    for (const id of promptIds) {
      for (const answer of replies.filter(one => one.promptId === id)) {
        replyIds.push(answer.id)
        promptIds.push(
          ...prompts.flatMap(one =>
            one.parentReplyId === answer.id ? [one.id] : []
          )
        )
      }
    }

    prompts.splice(
      0,
      Infinity,
      ...prompts.filter(one => !promptIds.includes(one.id))
    )
    replies.splice(
      0,
      Infinity,
      ...replies.filter(one => !replyIds.includes(one.id))
    )

    return {promptIds, replyIds}
  }

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  function snapshot(): AppEvent {
    return {
      type: 'SNAPSHOT',
      app: {version: '0.0.0'},
      replies: [],
      providers: PROVIDERS,
      models: {
        claude: [
          {
            id: 'fake',
            name: 'Fake',
            isDefault: true,
            resolvesTo: null,
            needsAppUpdate: false,
          },
          {
            id: 'swift',
            name: 'Swift',
            isDefault: false,
            resolvesTo: null,
            needsAppUpdate: false,
          },
        ],
        chatgpt: [],
      },
      lastModel: null,
      signIn: null,
      settings: {...settings},
      layout: DEFAULT_LAYOUT,
    }
  }

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'tree.turns') {
        await turnsLoads.held

        return {ok: true, value: {prompts: [...prompts], replies: [...replies]}}
      }

      if (command.type === 'settings.update') {
        Object.assign(settings, command.changes)
        publish({type: 'SETTINGS_CHANGED', settings: {...settings}})

        return {ok: true, value: {...settings}}
      }

      if (command.type === 'prompt.send') {
        const failedThere = prompts.filter(
          one =>
            one.parentReplyId === command.parentReplyId &&
            replies.some(
              answer => answer.promptId === one.id && answer.status === 'failed'
            )
        )

        const removed = {promptIds: [] as string[], replyIds: [] as string[]}

        for (const one of failedThere) {
          const cut = cutFrom(one.id)
          removed.promptIds.push(...cut.promptIds)
          removed.replyIds.push(...cut.replyIds)
        }

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
          status: sends.failure === null ? 'streaming' : 'failed',
          content: [],
          failure: sends.failure,
          createdAt,
        }

        prompts.push(sentPrompt)
        replies.push(started)

        return {ok: true, value: {prompt: sentPrompt, reply: started, removed}}
      }

      if (command.type === 'reply.stop') {
        return stops.refusal === null
          ? {ok: true, value: {}}
          : {ok: false, error: {code: 'handler-failed', message: stops.refusal}}
      }

      if (command.type === 'prompt.delete') {
        if (deletes.refusal !== null) {
          return {
            ok: false,
            error: {code: 'handler-failed', message: deletes.refusal},
          }
        }

        return {ok: true, value: cutFrom(command.promptId)}
      }

      if (command.type === 'tree.delete') {
        return deletes.refusal === null
          ? {ok: true, value: {}}
          : {
              ok: false,
              error: {code: 'handler-failed', message: deletes.refusal},
            }
      }

      if (command.type === 'reply.retry') {
        const where = replies.findIndex(one => one.id === command.replyId)
        const failed = replies[where]

        if (!failed) {
          return {ok: false, error: {code: 'not-found', message: 'Not here'}}
        }

        const again: Reply = {
          ...failed,
          status: 'streaming',
          content: [],
          failure: null,
        }

        replies[where] = again

        return {ok: true, value: {reply: again}}
      }

      return {ok: false, error: {code: 'not-found', message: 'Not here'}}
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener(snapshot())

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {
    ...bridge,
    sent,
    publish,
    snapshot,
    replies,
    stops,
    deletes,
    turnsLoads,
    sends,
  }
}

const probe = {render: async () => {}}

/**
 * An update made outside React lands in the same lane as every other such
 * update, so the commit that renders this one commits those queued before it
 * too, and flushes every effect still pending from earlier commits.
 */
function RenderProbe() {
  const [rendered, setRendered] = useState<{done: () => void} | null>(null)

  useLayoutEffect(() => rendered?.done(), [rendered])

  useLayoutEffect(() => {
    probe.render = async () =>
      new Promise(resolve => {
        setRendered({done: () => resolve()})
      })
  }, [])

  return null
}

/** Resolves once React has committed every update queued before the call. */
async function reactCaughtUp() {
  await probe.render()
}

function Providers({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <SettingsProvider>
        <ConnectionsProvider>
          <LiveReplies>
            <RenderProbe />
            <div style={{height: '100vh'}}>{children}</div>
          </LiveReplies>
        </ConnectionsProvider>
      </SettingsProvider>
    </QueryClientProvider>
  )
}

async function renderCanvas(saved: Saved) {
  const main = fakeMain(saved)
  globalThis.window.uz = main

  const screen = await render(<Canvas treeId={treeId} title="Tree" />, {
    wrapper: Providers,
  })

  return {main, screen}
}

function highlightedEdges() {
  return [...document.querySelectorAll('.react-flow__edge.on-thread')]
    .map(drawn => drawn.getAttribute('data-id'))
    .toSorted((a, b) => (a ?? '').localeCompare(b ?? ''))
}

function edge(source: number, target: number) {
  return `${uuid(source)}-${uuid(target)}`
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

async function settledViewport() {
  let frames = 0
  let counting = true

  function count() {
    frames++

    if (counting) requestAnimationFrame(count)
  }

  requestAnimationFrame(count)

  let last: string | null = null
  let framesAtLast = 0

  // On a loaded runner, two samples with no frame drawn between them can both
  // land mid-glide.
  try {
    await expect
      .poll(
        () => {
          const now = viewport()
          const settled = now === last && frames - framesAtLast >= 2
          last = now
          framesAtLast = frames

          return settled
        },
        {interval: 100}
      )
      .toBe(true)
  } finally {
    counting = false
  }

  return last
}

async function hoverAway() {
  await page.getByRole('group', {name: 'Orientation'}).hover()
}

/** The canvas itself, leaving out the slideout drawn over it. */
function canvas() {
  const flow = document.querySelector('.react-flow')

  if (!flow) throw new Error('The canvas is not drawn')

  return page.elementLocator(flow)
}

function nodeOf(turnText: string) {
  const box = canvas()
    .getByText(turnText)
    .element()
    .closest('.react-flow__node')

  if (!box) throw new Error(`${turnText} is not on the canvas`)

  return page.elementLocator(box)
}

function inputUnder(replyText: string) {
  return nodeOf(replyText).getByRole('textbox', {name: 'Prompt'})
}

/** Hovering the Reply slides its Input out. */
async function clickInputUnder(replyText: string) {
  await canvas().getByText(replyText).hover()
  await inputUnder(replyText).click()
}

function revealed(replyText: string) {
  return inputUnder(replyText)
    .element()
    .closest('[data-revealed]')
    ?.getAttribute('data-revealed')
}

function stemUnder(replyText: string) {
  const node = nodeOf(replyText).element()
  const box = page.getByText(replyText).element().closest('[data-turn]')

  if (!box) throw new Error(`${replyText} has no box`)

  const {bottom} = box.getBoundingClientRect()

  const stem = [...node.querySelectorAll('div')].find(candidate => {
    const {width, top} = candidate.getBoundingClientRect()

    return width < 4 && Math.abs(top - bottom) < 1
  })

  if (!stem) throw new Error(`${replyText} has no stem`)

  return stem
}

it('joins a Reply’s box to the Prompts under it with an unbroken line while its Input is hidden', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()
  await expect.poll(() => revealed('Reply one')).toBe('false')

  const node = nodeOf('Reply one').element().getBoundingClientRect()
  const stem = stemUnder('Reply one')

  expect(stem.getBoundingClientRect().bottom).toBeCloseTo(node.bottom, 0)
  expect(getComputedStyle(stem).opacity).toBe('1')

  const line = document
    .querySelector(`.react-flow__edge[data-id="${edge(11, 2)}"] path`)
    ?.getBoundingClientRect()

  const two = page
    .getByText('Prompt two')
    .element()
    .closest('[data-turn]')
    ?.getBoundingClientRect()

  expect(line?.top).toBeCloseTo(node.bottom, 0)
  expect(line?.bottom).toBeCloseTo(two?.top ?? Number.NaN, 0)

  await page.getByText('Reply one').hover()
  await expect.poll(() => getComputedStyle(stem).opacity).toBe('0')
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
  await clickInputUnder('Reply five')
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
    name: '2 Branches',
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

  await clickInputUnder('Reply three')
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

function chip() {
  return canvas().getByRole('group', {name: 'Failed Reply'})
}

async function chipDrawn() {
  await expect
    .element(page.getByRole('group', {name: 'Failed Reply'}).first())
    .toBeVisible()
}

/** Text the canvas shows as a Turn, not as a draft in an Input. */
function shownOnCanvas(text: string) {
  return canvas()
    .getByText(text, {exact: true})
    .elements()
    .filter(element => element.tagName !== 'TEXTAREA')
}

function chipNode() {
  const box = chip().element().closest('.react-flow__node')

  if (!box) throw new Error('No Failed chip on the canvas')

  return page.elementLocator(box)
}

it('moves the Active Thread to a Reply that fails as it starts, and sends its Prompt back to the Input it came from', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply three')).toBeVisible()
  main.sends.failure = {code: 'host-unreachable', message: 'No host'}

  await inputUnder('Reply three').fill('A thought')
  await userEvent.keyboard('{Enter}')
  await expect
    .element(chip().getByText('Claude could not be reached'))
    .toBeVisible()
  await hoverAway()

  await expect.element(inputUnder('Reply three')).toHaveValue('A thought')
  await expect.poll(() => revealed('Reply three')).toBe('true')
  expect(chipNode().getByRole('textbox').query()).toBeNull()
  expect(shownOnCanvas('A thought')).toEqual([])

  const chipId = chipNode().element().getAttribute('data-id')

  await expect
    .poll(highlightedEdges)
    .toEqual(
      [
        edge(1, 11),
        edge(11, 3),
        edge(3, 13),
        `${uuid(13)}-${chipId}`,
      ].toSorted()
    )
})

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
      const width = row[0]?.width ?? 0

      return (
        row.every(box => box.top === row[0]?.top) &&
        lefts.every((left, i) => i === 0 || left - (lefts[i - 1] ?? 0) >= width)
      )
    })
    .toBe(true)
})

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

it('moves focus to the streaming Reply’s Input a Prompt was sent for, hiding the one it was sent from', async () => {
  await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()

  await sendInto('Reply two', 'And then?')
  await hoverAway()

  const streaming = nodeOf('Writing…')
  await expect.element(streaming.getByRole('textbox')).toHaveFocus()
  await expect.poll(() => revealed('Writing…')).toBe('true')
  await expect.poll(() => revealed('Reply two')).toBe('false')
  await streaming.getByRole('textbox').fill('And after that?')
  await expect
    .element(streaming.getByRole('button', {name: 'Send'}))
    .toBeDisabled()
})

function samplePainted() {
  const painted = new Set<string>()
  let sampling = true

  function sample() {
    const drawn = document.querySelector('.react-flow__viewport')

    const shown = [...document.querySelectorAll('.react-flow__node')].some(
      node => getComputedStyle(node).visibility === 'visible'
    )

    if (drawn && shown && getComputedStyle(drawn).opacity !== '0') {
      painted.add(viewport())
    }

    if (sampling) requestAnimationFrame(sample)
  }

  function stop() {
    sampling = false

    return [...painted]
  }

  requestAnimationFrame(sample)
  onTestFinished(() => {
    sampling = false
  })

  return stop
}

it('shows a loaded Tree only once it is fitted, never at full size first', async () => {
  const stop = samplePainted()

  await renderCanvas(forkedTree())
  const fitted = await settledViewport()

  expect(stop()).toEqual([fitted])
})

it('zooms out just enough to show the whole Tree on its first Fork, and keeps the zoom on every other send', async () => {
  await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const loaded = zoomOf()
  await page.getByRole('button', {name: 'Zoom in'}).click()
  await expect.poll(zoomOf).toBeGreaterThan(loaded * 1.1)
  const zoomedIn = await settledViewport()
  const zoom = zoomOf()

  await sendInto('Reply two', 'Carry on')
  await expect.poll(viewport).not.toBe(zoomedIn)
  await settledViewport()
  expect(zoomOf()).toBe(zoom)

  await sendInto('Reply one', 'Another way')
  await expect.poll(zoomOf).toBeLessThan(zoom)
  // A glide's zoom dips on the way, so only the zoom it ends at counts.
  await settledViewport()
  expect(zoomOf()).toBeLessThan(zoom)
  const fitted = zoomOf()

  await sendInto('Reply two', 'Yet another')
  await settledViewport()
  expect(zoomOf()).toBe(fitted)
})

it('keeps the controls beside the Tree’s name, off the canvas, with only the minimap drawn on it', async () => {
  await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()

  const title = page.getByRole('heading', {name: 'Tree'}).element()
  const zoomIn = page.getByRole('button', {name: 'Zoom in'}).element()
  expect(title.closest('header')?.contains(zoomIn)).toBe(true)
  expect(canvas().element().contains(zoomIn)).toBe(false)

  await page.getByRole('button', {name: 'Show the minimap'}).click()
  await expect
    .element(canvas().getByRole('img', {name: 'Minimap'}))
    .toBeVisible()
})

function inputOffCenter(replyText: string) {
  const input = inputUnder(replyText).element().closest('form')

  if (!input) throw new Error(`${replyText} has no Input`)

  return offCenter(input)
}

function offCenter(element: Element) {
  const box = element.getBoundingClientRect()
  const frame = canvas().element().getBoundingClientRect()

  return Math.max(
    Math.abs(box.left + box.width / 2 - (frame.left + frame.width / 2)),
    Math.abs(box.top + box.height / 2 - (frame.top + frame.height / 2))
  )
}

it('zooms to the Active Thread’s Input at the zoom a new Tree starts at, however long its Reply, and puts the cursor in it', async () => {
  const long = ['Reply one', ...Array.from({length: 80}, () => 'More.')]

  await renderCanvas({
    ...linearTree(),
    replies: [reply(11, 1, long.join('\n\n')), reply(12, 2, 'Reply two')],
    settings: {limitTurnHeight: false},
  })
  await expect.element(page.getByText('Reply two')).toBeVisible()
  await settledViewport()

  await clickInputUnder('Reply one')
  await hoverAway()
  await page.getByRole('button', {name: 'Zoom out'}).click()
  await settledViewport()

  await page
    .getByRole('button', {name: 'Zoom to the Active Thread’s Input'})
    .click()
  await settledViewport()

  expect(zoomOf()).toBe(1)
  expect(inputOffCenter('Reply one')).toBeLessThan(2)
  await expect.element(inputUnder('Reply one')).toHaveFocus()
})

it('zooms to a failed Active Reply’s chip at the zoom a new Tree starts at, and leaves the cursor alone once a Retry gives it an Input', async () => {
  await renderCanvas(endingIn('failed', 'Cut off'))
  await expect.element(page.getByText('Connection lost')).toBeVisible()
  await settledViewport()

  await page.getByRole('button', {name: 'Zoom out'}).click()
  await settledViewport()

  await page
    .getByRole('button', {name: 'Zoom to the Active Thread’s Input'})
    .click()
  await settledViewport()

  expect(zoomOf()).toBe(1)
  expect(offCenter(chip().element())).toBeLessThan(2)

  await chip().getByRole('button', {name: 'Retry'}).click()
  await expect.element(inputUnder('Writing…')).toBeVisible()
  await expect.element(inputUnder('Writing…')).not.toHaveFocus()
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
    name: '2 Branches',
    exact: true,
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
    name: '2 Branches',
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
    name: '2 Branches',
  })

  await pill.click()
  await expect.element(page.getByText('Prompt five')).not.toBeInTheDocument()
  const folded = await settledViewport()

  await page.getByRole('status').getByText('1 streaming').click()
  await expect.element(page.getByText('Prompt five')).toBeVisible()
  await expect.element(pill).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(viewport).not.toBe(folded)
})

it('tells on a folded Fork’s pill that a Reply in its Branches is streaming, until it unfolds', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(15) ? {...one, status: 'streaming', content: []} : one
  )

  await renderCanvas(saved)
  await expect.element(page.getByText('Prompt five')).toBeVisible()

  const pill = nodeOf('Reply two').getByRole('button', {name: /Branches/})

  await expect.element(pill).toHaveAccessibleName('2 Branches')

  await pill.click()
  await expect.element(page.getByText('Prompt five')).not.toBeInTheDocument()
  await expect.element(pill).toHaveAccessibleName('2 Branches, 1 streaming')

  await nodeOf('Reply one')
    .getByRole('button', {name: /Branches/})
    .click()
  await expect.element(page.getByText('Prompt two')).not.toBeInTheDocument()
  await expect
    .element(nodeOf('Reply one').getByRole('button', {name: /Branches/}))
    .toHaveAccessibleName('2 Branches, 1 streaming')

  await nodeOf('Reply one')
    .getByRole('button', {name: /Branches/})
    .click()
  await expect.element(page.getByText('Reply two')).toBeVisible()
  const remounted = nodeOf('Reply two').getByRole('button', {name: /Branches/})

  await expect
    .element(remounted)
    .toHaveAccessibleName('2 Branches, 1 streaming')
  await remounted.click()
  await expect.element(page.getByText('Prompt five')).toBeVisible()
  await expect.element(remounted).toHaveAccessibleName('2 Branches')
})

it('unfolds a folded Fork when a Prompt is sent into it, showing the new Branch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await nodeOf('Reply two').getByRole('button', {name: '2 Branches'}).click()
  await expect.element(page.getByText('Prompt four')).not.toBeInTheDocument()

  await sendInto('Reply two', 'A third way')
  await expect.element(page.getByText('Prompt four')).toBeVisible()
  await expect
    .element(nodeOf('Reply two').getByRole('button', {name: '3 Branches'}))
    .toHaveAttribute('aria-expanded', 'true')
})

it('keeps a Fork’s card put on unfolding Branches folded since before an orientation switch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')

  // Folded before the switch, its cards are measured only once they show.
  await nodeOf('Reply two').getByRole('button', {name: '2 Branches'}).click()
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

  await nodeOf('Reply two').getByRole('button', {name: '2 Branches'}).click()
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)
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

const longText = Array.from({length: 40}, (_, i) => `Line ${i + 1}`).join('\n')

// Markdown folds single newlines into one paragraph.
const longReply = longText.replaceAll('\n', '\n\n')

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
  await expect.poll(rootPromptHeight).toBeCloseTo(capped, 0)
})

it('keeps a Reply let out by Show more open across an orientation switch', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Short')],
    replies: [reply(11, 1, longReply)],
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

function wheelOnce(deltaY: number) {
  const pane = document.querySelector('.react-flow__pane')

  if (!pane) throw new Error('The canvas is not drawn')

  pane.dispatchEvent(
    new WheelEvent('wheel', {deltaY, bubbles: true, cancelable: true})
  )
}

async function wheel(deltaY: number) {
  wheelOnce(deltaY)
  await settledViewport()
}

function lineTop(line: string) {
  return canvas()
    .getByText(line, {exact: true})
    .element()
    .getBoundingClientRect().top
}

async function showMoreScrolledTo(line: string) {
  const text = canvas().getByText(line, {exact: true}).element()
  const box = text.closest('.overflow-y-auto')
  const capped = box?.parentElement

  if (!box || !capped) throw new Error(`${line} is not in capped text`)

  box.scrollTop = 150
  const before = lineTop(line)

  await page
    .elementLocator(capped)
    .getByRole('button', {name: 'Show more'})
    .click()
  await expect
    .element(
      page.elementLocator(capped).getByRole('button', {name: 'Show less'})
    )
    .toBeVisible()
  await settledViewport()

  return before
}

it('keeps the text a Reply was scrolled to where it is on screen as Show more lets it out', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Short')],
    replies: [reply(11, 1, longReply)],
  })

  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const before = await showMoreScrolledTo('Line 12')
  expect(lineTop('Line 12')).toBeCloseTo(before, 0)
})

it('puts a long Fork’s Show more and its Branches pill on one line, at either end', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(11)
      ? {...one, content: [{type: 'text', text: longReply}]}
      : one
  )

  await renderCanvas(saved)
  await expect.element(page.getByText('Line 40')).toBeInTheDocument()

  const box = document
    .querySelector(`[data-turn="${uuid(11)}"]`)
    ?.closest('.react-flow__node')

  if (!box) throw new Error('Reply one is not on the canvas')

  const node = page.elementLocator(box)
  const more = node.getByRole('button', {name: 'Show more'})
  const pill = node.getByRole('button', {name: '2 Branches'})

  await expect.element(more).toBeVisible()
  await expect.element(pill).toBeVisible()

  const card = node.element().getBoundingClientRect()
  const left = more.element().getBoundingClientRect()
  const right = pill.element().getBoundingClientRect()

  expect(left.top).toBeLessThan(right.bottom)
  expect(right.top).toBeLessThan(left.bottom)
  expect(left.left - card.left).toBeLessThan(card.right - left.right)
  expect(card.right - right.right).toBeLessThan(right.left - card.left)
})

it('keeps a scrolled Fork’s text put as Show more lets it out and its card re-centers over its Branches', async () => {
  const saved = forkedTree()
  const otherText = longReply.replaceAll('Line', 'Other')

  const texts = new Map([
    [uuid(11), longReply],
    [uuid(12), otherText],
    [uuid(13), otherText],
  ])

  saved.replies = saved.replies.map(one => {
    const text = texts.get(one.id)

    return text === undefined ? one : {...one, content: [{type: 'text', text}]}
  })

  await renderCanvas({...saved, settings: {canvasOrientation: 'horizontal'}})
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const before = await showMoreScrolledTo('Line 12')
  expect(lineTop('Line 12')).toBeCloseTo(before, 0)
})

it('keeps the text at the canvas’s top edge where it is as Show less caps a Reply let out past it', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Short')],
    replies: [reply(11, 1, longReply)],
  })

  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()
  await page.getByRole('button', {name: 'Show more'}).click()
  const less = page.getByRole('button', {name: 'Show less'})
  await expect.element(less).toBeVisible()
  await settledViewport()

  await wheel(1600)
  const canvasTop = canvas().element().getBoundingClientRect().top
  const turn = nodeOf('Line 1').element().getBoundingClientRect()
  expect(turn.top).toBeLessThan(canvasTop)

  const read = [...nodeOf('Line 1').element().querySelectorAll('p')].find(
    line => line.getBoundingClientRect().top >= canvasTop
  )

  if (!read) throw new Error('No line is at the canvas’s top edge')

  const before = read.getBoundingClientRect().top

  // Below the window: a pointer click would scroll it into view first.
  less.element().dispatchEvent(new MouseEvent('click', {bubbles: true}))
  await expect
    .element(page.getByRole('button', {name: 'Show more'}))
    .toBeVisible()
  await settledViewport()

  const line = read.getBoundingClientRect()
  expect(line.top).toBeCloseTo(before, 0)

  const capped = read.closest('.overflow-y-auto')?.getBoundingClientRect()
  expect(capped?.top).toBeLessThanOrEqual(line.top)
  expect(capped?.bottom).toBeGreaterThanOrEqual(line.bottom)
})

it('lets long Turns take their full height when the Setting is off', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, longText)],
    replies: [reply(11, 1, 'Short')],
    settings: {limitTurnHeight: false},
  })

  await expect.element(page.getByText('Short')).toBeVisible()
  // Unscaled: opening fits the whole Tree, so the zoom follows its height.
  expect(rootPromptHeight() / zoomOf()).toBeGreaterThan(500)
  await expect
    .element(page.getByRole('button', {name: 'Show more'}))
    .not.toBeInTheDocument()
})

it('shows each Reply’s Context size, its details in a drawer the info button opens and a click on the blurred Reply closes, and the meter toward the Context window', async () => {
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

  await expect.element(page.getByText('12.3k ctx')).toBeVisible()

  const details = page
    .getByRole('complementary', {
      name: 'Context size details',
      includeHidden: true,
    })
    .nth(1)

  await expect.element(details).not.toBeVisible()
  await page.getByRole('button', {name: 'Context size details'}).nth(1).click()
  await expect.element(details).toBeVisible()
  await expect.element(details).toMatchTextContent(/This Exchange\+2\.3k/)
  await expect.element(details).toMatchTextContent(/Thread up to here12\.3k/)
  await expect.element(details).toMatchTextContent(/Context window200\.0k/)
  await details.getByRole('button', {name: 'Close'}).click()
  await expect.element(details).not.toBeVisible()

  const info = page.getByRole('button', {name: 'Context size details'}).nth(1)

  await info.click()
  await expect.element(details).toBeVisible()
  const replyTwo = page.getByText('Reply two')

  // The drawer covers the Reply's left, so the click lands on its right.
  await replyTwo.click({
    force: true,
    position: {x: replyTwo.element().getBoundingClientRect().width - 4, y: 4},
  })
  await expect.element(details).not.toBeVisible()

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

  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  const before = await settledViewport()

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

// A 720px window, the narrowest, leaves the canvas about 464px beside the sidebar.
it.each([
  {pane: 'wide', width: 1280},
  {pane: 'narrow', width: 464},
])(
  'puts an empty Tree’s root Prompt where its Input was, as wide, with the canvas holding still, on a $pane pane',
  async ({width}) => {
    await page.viewport(width, 800)
    onTestFinished(async () => page.viewport(1280, 800))
    const {main} = await renderCanvas({prompts: [], replies: []})
    const input = page.getByRole('textbox', {name: 'Prompt'})
    await expect.element(input).toBeVisible()
    const before = input.element().closest('form')?.getBoundingClientRect()

    if (!before) throw new Error('The Input is not drawn')

    const stop = samplePainted()
    await input.fill('Hello?')
    await userEvent.keyboard('{Enter}')
    await expect
      .poll(() => main.sent.filter(command => command.type === 'prompt.send'))
      .toEqual([expect.objectContaining({parentReplyId: null, text: 'Hello?'})])
    await expect.element(canvas().getByText('Hello?')).toBeVisible()
    await expect.element(canvas().getByText('Writing…')).toBeVisible()
    const held = await settledViewport()

    // Centering can land the Input on a half pixel the canvas rounds away.
    const placed = nodeOf('Hello?').element().getBoundingClientRect()
    expect(Math.abs(placed.left - before.left)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(placed.top - before.top)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(placed.width - before.width)).toBeLessThanOrEqual(0.5)
    expect(stop()).toEqual([held])
  }
)

function slideout() {
  return page.getByRole('dialog', {name: 'Chat'})
}

function slideoutInput() {
  return slideout().getByRole('textbox', {name: 'Prompt'})
}

/** The one in the card's header, before the one under the Reply's text. */
function chatButtonOf(replyText: string) {
  return nodeOf(replyText)
    .getByRole('button', {name: 'Open in Chat mode'})
    .first()
}

/** Each Turn's text, without the Provider's mark and Model pill a Reply shows. */
function chatTurns() {
  return [...slideout().element().querySelectorAll('[data-chat-turn]')].map(
    turn => {
      const label = [
        ...turn.querySelectorAll('[role="img"], [data-slot="badge"]'),
      ]
        .map(part => part.textContent)
        .join('')

      return turn.textContent.replace(label, '').trim()
    }
  )
}

function threadToReplyFour() {
  return [
    edge(1, 11),
    edge(11, 2),
    edge(2, 12),
    edge(12, 4),
    edge(4, 14),
  ].toSorted()
}

async function openChatAt(replyText: string) {
  return chatButtonOf(replyText).click()
}

function slideoutWidth() {
  return slideout().element().getBoundingClientRect().width
}

it('opens the slideout on a Reply’s Thread from its button, with one Input at its end that takes focus, and that Thread highlighted', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await openChatAt('Reply four')
  await expect.element(slideout()).toBeVisible()

  expect(chatTurns()).toEqual([
    'Prompt one',
    'Reply one',
    'Prompt two',
    'Reply two',
    'Prompt four',
    'Reply four',
  ])
  expect(slideoutInput().elements()).toHaveLength(1)
  await expect.element(slideoutInput()).toHaveFocus()

  await hoverAway()
  await expect.poll(highlightedEdges).toEqual(threadToReplyFour())
})

it('switches the slideout to another Reply’s Thread with its Input focused, and closes it when a canvas Input takes focus, leaving focus there', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  // The slideout covers the right of the canvas: the Branch on the left stays clickable.
  await openChatAt('Reply three')
  await expect
    .poll(chatTurns)
    .toEqual(['Prompt one', 'Reply one', 'Prompt three', 'Reply three'])
  await openChatAt('Reply four')

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
  await expect.element(slideoutInput()).toHaveFocus()
  await hoverAway()
  await expect.poll(highlightedEdges).toEqual(threadToReplyFour())

  await clickInputUnder('Reply two')
  await expect.element(slideout()).not.toBeInTheDocument()
  await expect.element(inputUnder('Reply two')).toHaveFocus()
  await hoverAway()
  await expect
    .poll(highlightedEdges)
    .toEqual([edge(1, 11), edge(11, 2), edge(2, 12)].toSorted())
})

it('branches from the slideout into a Reply that already has a response, and follows the new Branch', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await openChatAt('Reply one')
  await expect.poll(chatTurns).toEqual(['Prompt one', 'Reply one'])

  await slideoutInput().fill('A third way')
  await userEvent.keyboard('{Enter}')

  await expect
    .element(nodeOf('Reply one').getByRole('button', {name: '3 Branches'}))
    .toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    expect.objectContaining({parentReplyId: uuid(11), text: 'A third way'}),
  ])

  await expect
    .poll(chatTurns)
    .toEqual(['Prompt one', 'Reply one', 'A third way', 'Writing…'])
  await expect.element(slideoutInput()).toHaveFocus()
  await slideoutInput().fill('And then?')
  await expect
    .element(slideout().getByRole('button', {name: 'Stop'}))
    .toBeVisible()

  const sentPromptId = nodeOf('A third way').element().getAttribute('data-id')

  await hoverAway()
  await expect
    .poll(highlightedEdges)
    .toEqual(
      expect.arrayContaining([edge(1, 11), `${uuid(11)}-${sentPromptId}`])
    )
  expect(highlightedEdges()).toHaveLength(3)
})

it('hands focus back to the button that opened the slideout when it closes after a send from its Input', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await openChatAt('Reply five')
  await slideoutInput().fill('And then?')
  await userEvent.keyboard('{Enter}')
  await expect.poll(chatTurns).toContain('Writing…')
  await expect.element(slideoutInput()).toHaveFocus()

  await slideout().getByRole('button', {name: 'Close'}).click()
  await expect.element(slideout()).not.toBeInTheDocument()
  await expect.element(chatButtonOf('Reply five')).toHaveFocus()
})

it('opens the Model picker of a Reply’s Input on the canvas', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await nodeOf('Reply five').getByRole('combobox', {name: 'Model'}).click()
  await expect.element(page.getByRole('option', {name: 'Fake'})).toBeVisible()
})

function transitionOf(element: Element, property: string) {
  return element
    .getAnimations()
    .find(
      animation =>
        animation instanceof CSSTransition &&
        animation.transitionProperty === property
    )
}

function sliding(element: Element) {
  return transitionOf(element, 'translate') !== undefined
}

function fading(element: Element) {
  return transitionOf(element, 'opacity') !== undefined
}

function slideDistance(element: Element) {
  const {effect} = transitionOf(element, 'translate') ?? {}

  const keyframes =
    effect instanceof KeyframeEffect ? effect.getKeyframes() : []

  const offset = keyframes.find(({translate}) => translate !== 'none')
  const [x = ''] = String(offset?.translate).split(' ')
  const distance = Math.abs(Number.parseFloat(x))

  // A full slide comes back as a share of the width, like `100%`.
  return x.endsWith('%') ? (distance / 100) * element.clientWidth : distance
}

function expectShortFadingSlide(element: Element) {
  expect(fading(element)).toBe(true)
  expect(slideDistance(element)).toBeGreaterThan(0)
  expect(slideDistance(element)).toBeLessThan(element.clientWidth / 4)
}

async function setPlaybackRate(playbackRate: number) {
  await cdp().send('Animation.setPlaybackRate', {playbackRate})
}

/** Holds every animation where it starts until `setPlaybackRate(1)`. */
async function freezeAnimations() {
  await cdp().send('Animation.enable')
  await setPlaybackRate(0)
  onTestFinished(async () => setPlaybackRate(1))
}

async function freezeAnimationsAndTimers() {
  await freezeAnimations()
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  onTestFinished(() => {
    vi.useRealTimers()
  })
}

it('slides the slideout a short way in as it opens and out as it closes, fading as it goes', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await freezeAnimations()
  await openChatAt('Reply four')
  await expect.element(slideout()).toBeInTheDocument()
  const panel = slideout().element()
  expectShortFadingSlide(panel)
  await setPlaybackRate(1)
  await expect.poll(() => sliding(panel)).toBe(false)

  await setPlaybackRate(0)
  await slideout().getByRole('button', {name: 'Close'}).click()
  expect(panel.isConnected).toBe(true)
  expectShortFadingSlide(panel)
  await setPlaybackRate(1)
  await expect.poll(() => panel.isConnected).toBe(false)
})

it('keeps the slideout, inert, until its slide out ends, however long that takes', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await openChatAt('Reply four')
  const panel = slideout().element()
  await expect.poll(() => sliding(panel)).toBe(false)

  await freezeAnimationsAndTimers()
  await slideout().getByRole('button', {name: 'Close'}).click()
  await expect.poll(() => sliding(panel)).toBe(true)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  expect(panel.isConnected).toBe(true)
  const input = panel.querySelector('textarea')

  if (!input) throw new Error('The slideout has no Input')

  input.focus()
  expect(document.activeElement).not.toBe(input)

  await setPlaybackRate(1)
  await expect.poll(() => panel.isConnected).toBe(false)
})

function turnSlides() {
  return [...document.querySelectorAll('.react-flow__node')].flatMap(node => {
    const slide = transitionOf(node, 'transform')

    return slide ? [slide] : []
  })
}

function connectionsShown() {
  const connections = document.querySelector('.react-flow__edges')

  if (!connections) throw new Error('The connections are not drawn')

  return getComputedStyle(connections).opacity !== '0' || fading(connections)
}

function nodesOfKind(kind: 'exchange' | 'reply') {
  return document.querySelectorAll(`.react-flow__node-${kind}`).length
}

async function everyFrameUntil(check: () => boolean) {
  if (check()) return

  await new Promise(requestAnimationFrame)

  await everyFrameUntil(check)
}

it('keeps the connections hidden through an orientation switch until the last Turn arrives, however long that takes', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()
  expect(connectionsShown()).toBe(true)

  await freezeAnimationsAndTimers()
  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect.poll(() => turnSlides().length).toBeGreaterThan(0)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  expect(turnSlides().length).toBeGreaterThan(0)
  expect(connectionsShown()).toBe(false)

  await setPlaybackRate(1)
  await expect.poll(connectionsShown).toBe(true)
  expect(turnSlides()).toEqual([])
})

it('keeps the connections hidden while the Turns slide again for a Fork folded partway through an orientation switch', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()

  await freezeAnimationsAndTimers()
  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect.poll(() => nodesOfKind('exchange')).toBe(5)
  await expect.poll(() => turnSlides().length).toBeGreaterThan(0)
  // The canvas starts its wait in an effect and looks for slides a frame later.
  await reactCaughtUp()
  await new Promise(requestAnimationFrame)
  const firstSlides = new Set(turnSlides())
  // A canceled slide's `finished` is replaced by one that never settles.
  const firstEnds = [...firstSlides].map(async slide => slide.finished)

  // Frozen mid-slide, the card sits out of a pointer's and a role query's reach.
  const pill = [
    ...nodeOf('Reply two').element().querySelectorAll('button'),
  ].find(button => button.textContent === '2 Branches')

  if (!pill) throw new Error('Reply two shows no Fork pill')

  pill.click()
  await expect
    .poll(() => turnSlides().some(slide => !firstSlides.has(slide)))
    .toBe(true)

  for (const slide of firstSlides) {
    if (slide.playState === 'running') slide.finish()
  }

  await Promise.allSettled(firstEnds)
  vi.useRealTimers()
  await new Promise(requestAnimationFrame)
  await reactCaughtUp()
  expect(turnSlides().length).toBeGreaterThan(0)
  expect(connectionsShown()).toBe(false)

  await setPlaybackRate(1)
  await expect.poll(connectionsShown).toBe(true)
})

it('keeps a Reply’s stem hidden with the connections through a switch to vertical until the last Turn arrives', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()
  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect.poll(() => nodesOfKind('exchange')).toBe(5)
  await expect.poll(connectionsShown).toBe(true)
  await settledViewport()

  await freezeAnimationsAndTimers()
  await page.getByRole('button', {name: 'Vertical'}).click()
  await expect.poll(() => turnSlides().length).toBeGreaterThan(0)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  const stem = stemUnder('Reply one')
  expect(turnSlides().length).toBeGreaterThan(0)
  expect(connectionsShown()).toBe(false)
  expect(getComputedStyle(stem).opacity).toBe('0')

  await setPlaybackRate(1)
  await expect.poll(connectionsShown).toBe(true)
  await expect.poll(() => getComputedStyle(stem).opacity).toBe('1')
})

it('shows the connections after an orientation switch where no Turn moves, with no timer running', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one')],
    replies: [reply(11, 1, 'Reply one')],
  })
  await expect.element(page.getByText('Reply one')).toBeVisible()
  await settledViewport()

  // Both orientations measured, so the Reply comes back already in place.
  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect.element(canvas().getByText('Reply one')).toBeVisible()
  await page.getByRole('button', {name: 'Vertical'}).click()
  await expect.poll(connectionsShown).toBe(true)

  // `expect.poll` would advance the frozen timers.
  await freezeAnimationsAndTimers()
  await page.getByRole('button', {name: 'Horizontal'}).click()
  await everyFrameUntil(() => nodesOfKind('exchange') === 1)
  await page.getByRole('button', {name: 'Vertical'}).click()
  await everyFrameUntil(() => nodesOfKind('reply') === 1)
  expect(turnSlides()).toEqual([])
  await everyFrameUntil(connectionsShown)
})

it('slides the Turns and hides the connections when the orientation changes in Settings', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()

  await freezeAnimationsAndTimers()
  main.publish({
    type: 'SETTINGS_CHANGED',
    settings: {...DEFAULT_SETTINGS, canvasOrientation: 'horizontal'},
  })
  await expect.poll(() => turnSlides().length).toBeGreaterThan(0)
  expect(connectionsShown()).toBe(false)

  await setPlaybackRate(1)
  await expect.poll(connectionsShown).toBe(true)
})

it('slides the Context size drawer a short way in as it opens and out as it closes, fading as it goes', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one')],
    replies: [{...reply(11, 1, 'Reply one'), contextSize: 10_000}],
  })
  await expect.element(page.getByText('10.0k ctx')).toBeVisible()

  // Held at its start, the drawer is still invisible.
  const drawer = page.getByRole('complementary', {
    name: 'Context size details',
    includeHidden: true,
  })

  await freezeAnimations()
  await page.getByRole('button', {name: 'Context size details'}).click()
  expectShortFadingSlide(drawer.element())
  await setPlaybackRate(1)
  await expect.element(drawer).toBeVisible()
  await expect.poll(() => sliding(drawer.element())).toBe(false)

  await setPlaybackRate(0)
  await drawer.getByRole('button', {name: 'Close'}).click()
  expectShortFadingSlide(drawer.element())
})

it('widens the slideout to full screen and back with a transition rather than a jump', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await openChatAt('Reply four')
  await expect.element(slideout()).toBeVisible()
  const panel = slideout().element()
  await expect.poll(() => sliding(panel)).toBe(false)

  const canvasWidth = canvas().element().getBoundingClientRect().width

  await freezeAnimations()
  await slideout().getByRole('button', {name: 'Full screen'}).click()
  expect(transitionOf(panel, 'width')).toBeDefined()
  await setPlaybackRate(1)
  await expect.poll(slideoutWidth).toBe(canvasWidth)

  await setPlaybackRate(0)
  await slideout().getByRole('button', {name: 'Exit full screen'}).click()
  expect(transitionOf(panel, 'width')).toBeDefined()
  await setPlaybackRate(1)
  await expect.poll(slideoutWidth).toBeLessThan(canvasWidth / 2)
})

/** '' clears the emulation: no preference. */
async function emulateReducedMotion(value: 'reduce' | '') {
  await cdp().send('Emulation.setEmulatedMedia', {
    features: [{name: 'prefers-reduced-motion', value}],
  })
}

it('opens, widens and closes the slideout without sliding, fading or growing when the OS asks for reduced motion', async () => {
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  // Held at its start, a transition the slideout starts is still there to see.
  await freezeAnimations()
  await openChatAt('Reply four')
  await expect.element(slideout()).toBeInTheDocument()
  const panel = slideout().element()
  expect(sliding(panel)).toBe(false)
  expect(fading(panel)).toBe(false)

  await slideout().getByRole('button', {name: 'Full screen'}).click()
  expect(transitionOf(panel, 'width')).toBeUndefined()

  await slideout().getByRole('button', {name: 'Close'}).click()
  expect(sliding(panel)).toBe(false)
  expect(fading(panel)).toBe(false)
  await expect.poll(() => panel.isConnected).toBe(false)
})

it('zooms and switches orientation without gliding or hiding the connections when the OS asks for reduced motion', async () => {
  await emulateReducedMotion('reduce')
  onTestFinished(async () => emulateReducedMotion(''))
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await expect.poll(viewport).not.toContain('translate(0px, 0px)')
  await settledViewport()

  const loaded = zoomOf()
  await page.getByRole('button', {name: 'Zoom in'}).click()
  expect(zoomOf()).toBeCloseTo(loaded * 1.2, 2)

  let hidden = false

  const observer = new MutationObserver(() => {
    hidden ||= document.querySelector('.canvas-switching') !== null
  })

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  })
  onTestFinished(() => observer.disconnect())

  await page.getByRole('button', {name: 'Horizontal'}).click()

  const gliding = [...document.querySelectorAll('.react-flow__node')].filter(
    node => node.getAnimations().length > 0
  )

  expect(gliding).toEqual([])
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBeGreaterThan(0)
  expect(hidden).toBe(false)
})

function fieldElsewhere() {
  const field = document.createElement('input')

  field.setAttribute('aria-label', 'Tree name')
  document.body.append(field)
  onTestFinished(() => field.remove())

  return page.getByRole('textbox', {name: 'Tree name'})
}

it('scrolls the slideout to the Reply it opened from, expands to cover the canvas, and closes with Esc unless the user is typing elsewhere, or with its close control, handing focus back to the button that opened it', async () => {
  clock = 0
  await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    replies: [
      reply(11, 1, `Reply one\n\n${longReply}`),
      reply(12, 2, `Reply two\n\n${longReply}`),
    ],
  })
  await expect.element(page.getByText('Prompt two')).toBeVisible()

  await openChatAt('Reply two')
  await expect.element(slideout()).toBeVisible()

  const scroller = slideout().element().querySelector('.overflow-y-auto')

  const turn = slideout()
    .element()
    .querySelector(`[data-chat-turn="${uuid(12)}"]`)

  if (!scroller || !turn) throw new Error('The slideout does not scroll')

  expect(scroller.scrollTop).toBeGreaterThan(0)
  expect(
    turn.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  ).toBeLessThan(40)

  const canvasWidth = canvas().element().getBoundingClientRect().width

  expect(slideoutWidth()).toBeLessThan(canvasWidth / 2)

  await fieldElsewhere().fill('A name')
  await userEvent.keyboard('{Escape}')
  expect(slideout().element()).toHaveAttribute('data-open')

  await slideout().getByRole('button', {name: 'Full screen'}).click()
  await expect.poll(slideoutWidth).toBe(canvasWidth)
  await slideout().getByRole('button', {name: 'Exit full screen'}).click()
  await expect.poll(slideoutWidth).toBeLessThan(canvasWidth / 2)

  await userEvent.keyboard('{Escape}')
  await expect.element(slideout()).not.toBeInTheDocument()
  await expect.element(chatButtonOf('Reply two')).toHaveFocus()

  await openChatAt('Reply two')
  await openChatAt('Reply one')
  await slideout().getByRole('button', {name: 'Close'}).click()
  await expect.element(slideout()).not.toBeInTheDocument()
  await expect.element(chatButtonOf('Reply one')).toHaveFocus()
})

function finishStopped(main: ReturnType<typeof fakeMain>, replyId: string) {
  main.publish({treeId, replyId, type: 'RUN_FINISHED', status: 'stopped'})
}

function endingIn(status: Reply['status'], text = 'Reply two'): Saved {
  clock = 0

  return {
    prompts: [prompt(1, null, 'Prompt one'), prompt(2, 11, 'Prompt two')],
    replies: [
      reply(11, 1, 'Reply one'),
      {
        ...reply(12, 2, text),
        status,
        failure:
          status === 'failed'
            ? {code: 'connection-lost', message: 'ECONNRESET'}
            : null,
      },
    ],
  }
}

const COMPACTED =
  'Compacted here. The AI remembers the Turns above from a summary.'

/** Top to bottom, the Compaction markers among the Turns' texts. */
function downThrough(surface: Locator, ...texts: string[]) {
  return [...texts, COMPACTED]
    .flatMap(text =>
      surface
        .getByText(text)
        .elements()
        .map(element => ({text, top: element.getBoundingClientRect().top}))
    )
    .toSorted((a, b) => a.top - b.top)
    .map(({text}) => (text === COMPACTED ? 'marker' : text))
}

it('marks the Reply a Compaction happened in between its Prompt and what it says, in both orientations and in the slideout, and no other Reply', async () => {
  const saved = endingIn('complete')

  saved.replies = saved.replies.map(one =>
    one.id === uuid(12) ? {...one, compacted: true} : one
  )
  await renderCanvas(saved)
  await expect.element(page.getByText('Reply two')).toBeVisible()

  await expect.element(nodeOf('Reply two').getByText(COMPACTED)).toBeVisible()
  expect(
    downThrough(canvas(), 'Prompt one', 'Reply one', 'Prompt two', 'Reply two')
  ).toEqual(['Prompt one', 'Reply one', 'Prompt two', 'marker', 'Reply two'])

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(2)
  await expect.element(nodeOf('Reply two').getByText(COMPACTED)).toBeVisible()
  expect(downThrough(nodeOf('Reply two'), 'Prompt two', 'Reply two')).toEqual([
    'Prompt two',
    'marker',
    'Reply two',
  ])
  expect(canvas().getByText(COMPACTED).elements()).toHaveLength(1)

  await openChatAt('Reply two')
  await expect.element(slideout().getByText(COMPACTED)).toBeVisible()
  expect(
    downThrough(
      slideout(),
      'Prompt one',
      'Reply one',
      'Prompt two',
      'Reply two'
    )
  ).toEqual(['Prompt one', 'Reply one', 'Prompt two', 'marker', 'Reply two'])
})

it('gives a stopped Reply an Input and shows a failed one only as a Failed chip with Retry, with no Input, on the canvas and in the slideout', async () => {
  clock = 0
  const saved = forkedTree()

  saved.replies = saved.replies.map(one => {
    if (one.id === uuid(12)) return {...one, status: 'stopped'}

    if (one.id === uuid(13)) {
      return {
        ...one,
        status: 'failed',
        failure: {code: 'disk-full', message: 'ENOSPC'},
      }
    }

    return one
  })

  const {main} = await renderCanvas(saved)
  await chipDrawn()
  await expect.element(chip().getByText('Disk full')).toBeVisible()

  expect(document.querySelectorAll('textarea')).toHaveLength(4)
  await expect.element(inputUnder('Reply two')).toBeInTheDocument()
  expect(chipNode().getByRole('textbox').query()).toBeNull()
  await expect
    .element(chip().getByRole('button', {name: 'Retry'}))
    .toBeVisible()
  expect(chip().element().textContent).toBe('FailedDisk fullRetry')
  expect(shownOnCanvas('Prompt three')).toEqual([])
  expect(canvas().getByText('Reply three').query()).toBeNull()

  await openChatAt('Reply four')
  main.sends.failure = {code: 'connection-lost', message: 'ECONNRESET'}
  await slideoutInput().fill('A thought')
  await userEvent.keyboard('{Enter}')
  await expect.element(slideout().getByText('Connection lost')).toBeVisible()

  expect(chatTurns()).toEqual([
    'Prompt one',
    'Reply one',
    'Prompt two',
    'Reply twoStopped',
    'Prompt four',
    'Reply four',
    'FailedConnection lostRetry',
  ])
  await expect.element(slideoutInput()).toHaveValue('A thought')
  await expect
    .element(slideout().getByRole('button', {name: 'Retry'}))
    .toBeVisible()
})

function finish(
  main: ReturnType<typeof fakeMain>,
  replyId: string,
  status: 'complete' | 'failed'
) {
  main.publish({
    treeId,
    replyId,
    type: 'RUN_FINISHED',
    status,
    ...(status === 'failed' && {
      failure: {code: 'connection-lost', message: 'ECONNRESET'},
    }),
  })
}

it('retries a failed Reply in place: its Prompt and the same Reply stream again from nothing, and a failed Retry collapses back to the chip', async () => {
  const {main} = await renderCanvas(endingIn('failed', 'Cut off'))
  await chipDrawn()
  await expect.element(chip().getByText('Connection lost')).toBeVisible()
  expect(shownOnCanvas('Prompt two')).toEqual([])

  await chip().getByRole('button', {name: 'Retry'}).click()

  expect(main.sent.filter(command => command.type === 'reply.retry')).toEqual([
    {type: 'reply.retry', treeId, replyId: uuid(12)},
  ])
  await expect.element(page.getByText('Writing…')).toBeVisible()
  await expect.poll(() => shownOnCanvas('Prompt two')).toHaveLength(1)
  expect(page.getByText('Cut off').query()).toBeNull()
  expect(page.getByText('Connection lost').query()).toBeNull()
  await expect
    .element(page.getByRole('status').getByText('1 streaming'))
    .toBeVisible()
  expect(nodeCount()).toBe(4)

  const ids = {treeId, replyId: uuid(12)}
  main.publish({...ids, type: 'RUN_STARTED'})
  main.publish({...ids, type: 'TEXT_DELTA', delta: 'Second try'})
  await expect.element(page.getByText('Second try')).toBeVisible()

  finish(main, uuid(12), 'failed')
  await expect.element(chip().getByText('Connection lost')).toBeVisible()
  expect(shownOnCanvas('Prompt two')).toEqual([])
  expect(page.getByText('Second try').query()).toBeNull()
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')
})

it('takes the failed Prompt back out of the Input once a Retry succeeds, unless the user changed it', async () => {
  const {main} = await renderCanvas(endingIn('failed', 'Cut off'))
  await chipDrawn()
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')

  await chip().getByRole('button', {name: 'Retry'}).click()
  await expect.element(page.getByText('Writing…')).toBeVisible()
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')
  finish(main, uuid(12), 'complete')
  await expect.element(inputUnder('Reply one')).toHaveValue('')

  finish(main, uuid(12), 'failed')
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')
  await inputUnder('Reply one').fill('Prompt two, reworded')
  await chip().getByRole('button', {name: 'Retry'}).click()
  await expect.element(page.getByText('Writing…')).toBeVisible()
  finish(main, uuid(12), 'complete')
  await expect.element(page.getByText('Writing…')).not.toBeInTheDocument()
  await expect
    .element(inputUnder('Reply one'))
    .toHaveValue('Prompt two, reworded')
})

it('takes the failed Prompt back out of the Input once another window sends in its place', async () => {
  const {main} = await renderCanvas(endingIn('failed', 'Cut off'))
  await chipDrawn()
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')

  await main.send({
    type: 'prompt.send',
    treeId,
    parentReplyId: uuid(11),
    text: 'Sent elsewhere',
    model: {provider: 'claude', model: 'fake'},
  })
  main.publish(main.snapshot())

  await expect.element(page.getByText('Sent elsewhere')).toBeVisible()
  expect(chip().query()).toBeNull()
  await expect.element(inputUnder('Reply one')).toHaveValue('')
})

it('puts a failed Prompt below the draft already in its Input, after a blank line', async () => {
  const {main} = await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()

  await sendInto('Reply two', 'And then?')
  const failedId = main.replies.at(-1)?.id ?? ''
  await clickInputUnder('Reply two')
  await userEvent.keyboard('Meanwhile')

  finish(main, failedId, 'failed')
  await expect.element(chip()).toBeVisible()
  await expect
    .element(inputUnder('Reply two'))
    .toHaveValue('Meanwhile\n\nAnd then?')
})

function chipFor({promptId}: Reply) {
  const box = canvas()
    .element()
    .querySelector(`.react-flow__node[data-id="${promptId}"]`)

  if (!box) throw new Error('No Failed chip for this Reply on the canvas')

  return page.elementLocator(box)
}

it('takes each failed Prompt back out of an Input that holds two once its Retry succeeds, leaving the other', async () => {
  const {main} = await renderCanvas(linearTree())
  await expect.element(page.getByText('Reply two')).toBeVisible()

  await sendInto('Reply two', 'First ask')
  const first = main.replies.at(-1)
  await clickInputUnder('Reply two')
  await userEvent.keyboard('Second ask{Enter}')
  await expect.element(page.getByText('Second ask')).toBeVisible()
  const second = main.replies.at(-1)

  if (!first || !second) throw new Error('The sends made no Replies')

  finish(main, first.id, 'failed')
  await expect.element(inputUnder('Reply two')).toHaveValue('First ask')
  finish(main, second.id, 'failed')
  await expect
    .element(inputUnder('Reply two'))
    .toHaveValue('First ask\n\nSecond ask')

  await chipFor(first).getByRole('button', {name: 'Retry'}).click()
  await expect.element(page.getByText('Writing…')).toBeVisible()
  finish(main, first.id, 'complete')
  await expect.element(inputUnder('Reply two')).toHaveValue('Second ask')

  await chipFor(second).getByRole('button', {name: 'Retry'}).click()
  await expect.element(page.getByText('Writing…')).toBeVisible()
  finish(main, second.id, 'complete')
  await expect.element(inputUnder('Reply two')).toHaveValue('')
})

function modelIn(input: Locator) {
  return input.element().closest('form')?.querySelector('[role="combobox"]')
    ?.textContent
}

it('sends the restored Prompt unchanged as Retry would, on its Model, in place of the failed one so the Reply above stays no Fork, before the Turns are fetched again', async () => {
  const saved = endingIn('failed', 'Cut off')
  saved.replies = saved.replies.map(one =>
    one.id === uuid(12) ? {...one, model: 'swift'} : one
  )

  const {main} = await renderCanvas(saved)
  await chipDrawn()
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')
  expect(modelIn(inputUnder('Reply one'))).toContain('Swift')
  main.turnsLoads.held = new Promise(() => {})

  await inputUnder('Reply one').click()
  await userEvent.keyboard('{Enter}')

  await expect.element(page.getByText('Writing…')).toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    {
      type: 'prompt.send',
      treeId,
      parentReplyId: uuid(11),
      text: 'Prompt two',
      model: {provider: 'claude', model: 'swift'},
    },
  ])
  expect(chip().query()).toBeNull()
  await expect.poll(() => shownOnCanvas('Prompt two')).toHaveLength(1)
  expect(nodeCount()).toBe(4)
  expect(
    nodeOf('Reply one')
      .getByRole('button', {name: /Branches/})
      .query()
  ).toBeNull()
})

it('holds Send on a restored Model that is no longer offered, until another is picked', async () => {
  const saved = endingIn('failed', 'Cut off')
  saved.replies = saved.replies.map(one =>
    one.id === uuid(12) ? {...one, model: 'retired'} : one
  )

  const {main} = await renderCanvas(saved)
  await chipDrawn()
  const node = nodeOf('Reply one')
  await expect.element(inputUnder('Reply one')).toHaveValue('Prompt two')
  await expect
    .element(node.getByText('retired is no longer offered'))
    .toBeVisible()
  await expect.element(node.getByRole('button', {name: 'Send'})).toBeDisabled()

  await node.getByRole('combobox', {name: 'Model'}).click()
  await page.getByRole('option', {name: 'Fake'}).click()
  await node.getByRole('button', {name: 'Send'}).click()

  await expect.element(page.getByText('Writing…')).toBeVisible()
  expect(
    main.sent.flatMap(command =>
      command.type === 'prompt.send' ? [command.model] : []
    )
  ).toEqual([{provider: 'claude', model: 'fake'}])
})

it('shows a failed root Prompt as the chip over the root Input holding it, and sends from there a new root, keeping the Tree', async () => {
  clock = 0

  const {main} = await renderCanvas({
    prompts: [prompt(1, null, 'First try')],
    replies: [
      {
        ...reply(11, 1, 'Cut off'),
        status: 'failed',
        failure: {code: 'connection-lost', message: 'ECONNRESET'},
      },
    ],
  })

  await chipDrawn()
  await expect.element(chip().getByText('Connection lost')).toBeVisible()
  expect(nodeCount()).toBe(1)
  expect(shownOnCanvas('First try')).toEqual([])
  expect(canvas().getByText('Cut off').query()).toBeNull()

  const rootInput = chipNode().getByRole('textbox', {name: 'Prompt'})
  await expect.element(rootInput).toHaveValue('First try')
  expect(rootInput.element().getBoundingClientRect().top).toBeGreaterThan(
    chip().element().getBoundingClientRect().bottom
  )

  await rootInput.click()
  await userEvent.keyboard('{Enter}')

  await expect.element(page.getByText('Writing…')).toBeVisible()
  await expect.poll(() => shownOnCanvas('First try')).toHaveLength(1)
  expect(chip().query()).toBeNull()
  expect(nodeCount()).toBe(2)
  expect(
    main.sent.flatMap(command =>
      command.type === 'prompt.send' || command.type === 'tree.delete'
        ? [command]
        : []
    )
  ).toEqual([
    {
      type: 'prompt.send',
      treeId,
      parentReplyId: null,
      text: 'First try',
      model: {provider: 'claude', model: 'fake'},
    },
  ])
})

it('shows a root Reply that fails with the slideout open on it only as the chip, its Prompt back in the slideout’s Input, and sends from there a new root', async () => {
  clock = 0

  const {main} = await renderCanvas({
    prompts: [prompt(1, null, 'First try')],
    replies: [{...reply(11, 1, ''), status: 'streaming', content: []}],
  })

  await expect.element(page.getByText('Writing…')).toBeVisible()
  await openChatAt('Writing…')
  finish(main, uuid(11), 'failed')

  await expect.element(slideout().getByText('Connection lost')).toBeVisible()
  expect(chatTurns()).toEqual(['FailedConnection lostRetry'])
  await expect.element(slideoutInput()).toHaveValue('First try')

  await slideoutInput().click()
  await userEvent.keyboard('{Enter}')

  await expect.element(slideout().getByText('Writing…')).toBeVisible()
  expect(main.sent.filter(command => command.type === 'prompt.send')).toEqual([
    {
      type: 'prompt.send',
      treeId,
      parentReplyId: null,
      text: 'First try',
      model: {provider: 'claude', model: 'fake'},
    },
  ])
})

it('stops the streaming Reply at the end of the Active Thread with Esc, unless the user is typing elsewhere', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))
  await expect.element(page.getByText('Writing…')).toBeVisible()

  await fieldElsewhere().fill('A name')
  await userEvent.keyboard('{Escape}')
  expect(main.sent.map(command => command.type)).not.toContain('reply.stop')

  await page.getByRole('button', {name: 'Zoom in'}).click()
  await userEvent.keyboard('{Escape}')

  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(12)},
  ])

  finishStopped(main, uuid(12))
  await expect.element(page.getByText('Stopped')).toBeVisible()
  await expect.element(inputUnder('Stopped')).toBeInTheDocument()
})

it('shares a Stop from Esc with the Reply’s button: Stopping… until it ends, sent once, and a refusal shown', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))
  await expect.element(page.getByText('Writing…')).toBeVisible()
  main.stops.refusal = 'Claude is not running.'

  await userEvent.keyboard('{Escape}')

  await expect.element(page.getByText('Claude is not running.')).toBeVisible()
  await expect.element(page.getByRole('button', {name: 'Stop'})).toBeEnabled()

  main.stops.refusal = null
  await userEvent.keyboard('{Escape}')
  await expect
    .element(page.getByRole('button', {name: 'Stopping…'}))
    .toBeDisabled()
  await userEvent.keyboard('{Escape}')

  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(12)},
    {type: 'reply.stop', treeId, replyId: uuid(12)},
  ])
  expect(page.getByText('Claude is not running.').query()).toBeNull()
})

it('stops the slideout’s streaming Reply with Esc from its Input rather than closing the slideout', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))
  await expect.element(page.getByText('Writing…')).toBeVisible()

  await openChatAt('Writing…')
  await expect.element(slideout()).toBeVisible()
  await expect.element(slideout().getByText('Writing…')).toBeVisible()
  await expect.element(slideoutInput()).toHaveFocus()

  await userEvent.keyboard('{Escape}')

  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(12)},
  ])
  expect(slideout().element()).toHaveAttribute('data-open')

  finishStopped(main, uuid(12))
  await expect.element(slideout().getByText('Stopped')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(slideout()).not.toBeInTheDocument()
})

it('stops the streaming Reply with Esc from the Context size drawer rather than closing the drawer', async () => {
  const saved = endingIn('streaming', '')

  saved.replies = saved.replies.map(one =>
    one.id === uuid(11) ? {...one, contextSize: 10_000} : one
  )

  const {main} = await renderCanvas(saved)
  await expect.element(page.getByText('Writing…')).toBeVisible()

  const details = page.getByRole('complementary', {
    name: 'Context size details',
    includeHidden: true,
  })

  const info = page.getByRole('button', {name: 'Context size details'})

  await info.click()
  const close = details.getByRole('button', {name: 'Close'})

  await expect.element(close).toBeVisible()
  close.element().focus()

  await userEvent.keyboard('{Escape}')

  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(12)},
  ])
  await expect.element(info).toHaveAttribute('aria-expanded', 'true')

  finishStopped(main, uuid(12))
  await expect.element(page.getByText('Stopped')).toBeVisible()

  await userEvent.keyboard('{Escape}')
  await expect.element(info).toHaveAttribute('aria-expanded', 'false')
  await expect.element(details).not.toBeVisible()
})

it('leaves a streaming Reply going on Esc with the Setting off, on the canvas and in the slideout, which Esc closes', async () => {
  const {main} = await renderCanvas({
    ...endingIn('streaming', ''),
    settings: {escStopsReply: false},
  })

  await expect.element(page.getByText('Writing…')).toBeVisible()

  await page.getByRole('button', {name: 'Zoom in'}).click()
  await userEvent.keyboard('{Escape}')

  await openChatAt('Writing…')
  await expect.element(slideoutInput()).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  await expect.element(slideout()).not.toBeInTheDocument()

  expect(main.sent.map(command => command.type)).not.toContain('reply.stop')
})

function bottomChatButtonOf(replyText: string) {
  return nodeOf(replyText)
    .getByRole('button', {name: 'Open in Chat mode'})
    .last()
}

function chatTurnIds() {
  return [...slideout().element().querySelectorAll('[data-chat-turn]')].map(
    turn => turn.getAttribute('data-chat-turn')
  )
}

it.each([true, false])(
  'opens a Reply in the slideout from the bottom of its card, long or short, with a Fork pill or not (Limit Turn height %s), and keeps the header’s button',
  async limitTurnHeight => {
    const saved = forkedTree()

    saved.replies = saved.replies.map(one =>
      one.id === uuid(11)
        ? {...one, content: [{type: 'text', text: `Reply one\n\n${longReply}`}]}
        : one
    )

    await renderCanvas({...saved, settings: {limitTurnHeight}})
    await expect.element(page.getByText('Reply five')).toBeVisible()

    expect(bottomChatButtonOf('Reply one').element().closest('header')).toBe(
      null
    )
    await bottomChatButtonOf('Reply one').click()
    await expect.poll(chatTurnIds).toEqual([uuid(1), uuid(11)])

    await bottomChatButtonOf('Reply four').click()
    await expect
      .poll(chatTurnIds)
      .toEqual([uuid(1), uuid(11), uuid(2), uuid(12), uuid(4), uuid(14)])

    expect(chatButtonOf('Reply one').element().closest('header')).not.toBeNull()
    expect(
      nodeOf('Prompt two')
        .getByRole('button', {name: 'Open in Chat mode'})
        .query()
    ).toBeNull()
  }
)

it('stops a streaming Reply off the Active Thread from its card’s bottom row, which keeps its height as Stop goes', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(13) ? {...one, status: 'streaming', content: []} : one
  )

  const {main} = await renderCanvas(saved)
  await expect.element(page.getByText('Prompt five')).toBeVisible()

  // In layout pixels: the canvas may still be zooming to fit.
  const card = document.querySelector<HTMLElement>(`[data-turn="${uuid(13)}"]`)

  if (!card) throw new Error('Reply three has no card')

  const stop = nodeOf('Writing…').getByRole('button', {name: 'Stop'})

  await expect.element(stop).toBeVisible()
  expect(stop.element().parentElement).toBe(
    bottomChatButtonOf('Writing…').element().parentElement
  )
  const height = card.offsetHeight

  await stop.click()

  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(13)},
  ])

  finishStopped(main, uuid(13))
  await expect.element(canvas().getByText('Stopped')).toBeVisible()
  expect(
    nodeOf('Stopped').getByRole('button', {name: /Stop/}).query()
  ).toBeNull()
  expect(card.offsetHeight).toBe(height)
})

it('swaps Send for Stop in the slideout’s Input while its Reply streams, keeping focus and the draft, with Stopping… and a refusal shown', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))
  await expect.element(page.getByText('Writing…')).toBeVisible()

  await openChatAt('Writing…')
  await slideoutInput().fill('And then?')
  expect(slideout().getByRole('button', {name: 'Send'}).query()).toBeNull()

  main.stops.refusal = 'Claude is not running.'
  await slideout().getByRole('button', {name: 'Stop'}).click()
  await expect
    .element(slideout().getByText('Claude is not running.'))
    .toBeVisible()
  await expect.element(slideoutInput()).toHaveFocus()

  main.stops.refusal = null
  await slideout().getByRole('button', {name: 'Stop'}).click()
  await expect
    .element(slideout().getByRole('button', {name: 'Stopping…'}))
    .toBeDisabled()
  expect(slideout().getByText('Claude is not running.').query()).toBeNull()
  expect(main.sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId: uuid(12)},
    {type: 'reply.stop', treeId, replyId: uuid(12)},
  ])

  finishStopped(main, uuid(12))
  await expect
    .element(slideout().getByRole('button', {name: 'Send'}))
    .toBeEnabled()
  expect(slideout().getByRole('button', {name: /Stop/}).query()).toBeNull()
  await expect.element(slideoutInput()).toHaveValue('And then?')
  await expect.element(slideoutInput()).toHaveFocus()
})

async function pressStop(stop: Locator) {
  await expect.element(stop).toBeVisible()
  const button = stop.element()

  if (!(button instanceof HTMLElement)) throw new Error('Stop is not a button')

  button.focus()
  await userEvent.keyboard('{Enter}')
}

it('keeps focus on a card’s Stop pressed from the keyboard through Stopping…, then hands it to the card’s slideout button', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))

  await expect.element(page.getByText('Writing…')).toBeVisible()
  await pressStop(nodeOf('Writing…').getByRole('button', {name: 'Stop'}))
  await expect
    .element(nodeOf('Writing…').getByRole('button', {name: 'Stopping…'}))
    .toHaveFocus()

  finishStopped(main, uuid(12))
  await expect.element(canvas().getByText('Stopped')).toBeVisible()
  await expect.element(bottomChatButtonOf('Stopped')).toHaveFocus()
})

it('keeps focus on the slideout’s Stop pressed from the keyboard through Stopping…, then hands it to the Input', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))

  await expect.element(page.getByText('Writing…')).toBeVisible()
  await openChatAt('Writing…')
  await pressStop(slideout().getByRole('button', {name: 'Stop'}))
  await expect
    .element(slideout().getByRole('button', {name: 'Stopping…'}))
    .toHaveFocus()

  finishStopped(main, uuid(12))
  await expect.element(slideoutInput()).toHaveFocus()
})

it('keeps the slideout on the newest text of a streaming Reply until the user scrolls up', async () => {
  const {main} = await renderCanvas(endingIn('streaming', ''))
  await expect.element(page.getByText('Writing…')).toBeVisible()

  await openChatAt('Writing…')
  await expect.element(slideout().getByText('Writing…')).toBeVisible()

  const scroller = slideout().element().querySelector('.overflow-y-auto')

  if (!scroller) throw new Error('The slideout does not scroll')

  const ids = {treeId, replyId: uuid(12)}

  main.publish({...ids, type: 'RUN_STARTED'})
  main.publish({
    ...ids,
    type: 'TEXT_DELTA',
    delta: longReply,
  })
  await expect.element(slideout().getByText('Line 40')).toBeVisible()
  await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
  expect(
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
  ).toBeLessThan(1)

  await new Promise(resolve => {
    scroller.addEventListener('scroll', resolve, {once: true})
    scroller.scrollTop = 0
  })

  main.publish({...ids, type: 'TEXT_DELTA', delta: '\n\nThe last line'})
  await expect
    .element(slideout().getByText('The last line'))
    .toBeInTheDocument()
  // Resize observers run after a frame's animation callbacks.
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  expect(scroller.scrollTop).toBe(0)
})

function bottomOf(element: Element) {
  return element.getBoundingClientRect().bottom
}

/** A wheel, then the end of its gesture, which the canvas waits a timer for. */
async function wheelGesture(deltaY: number) {
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await wheel(deltaY)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
}

it('keeps a streaming Reply’s bottom on the canvas as it grows, until the user scrolls up and again once they scroll back', async () => {
  const {main} = await renderCanvas({
    ...linearTree(),
    settings: {limitTurnHeight: false},
  })

  await expect.element(page.getByText('Reply two')).toBeVisible()
  await settledViewport()

  await sendInto('Reply two', 'And then?')
  await expect.element(canvas().getByText('Writing…')).toBeVisible()
  const replyId = main.replies.at(-1)?.id

  if (replyId === undefined) throw new Error('No Reply was started')

  const ids = {treeId, replyId}
  const pane = canvas().element()

  main.publish({...ids, type: 'RUN_STARTED'})
  main.publish({
    ...ids,
    type: 'TEXT_DELTA',
    delta: longReply,
  })
  await expect.element(canvas().getByText('Line 40')).toBeInTheDocument()
  const streaming = nodeOf('Line 40').element()
  await settledViewport()
  expect(bottomOf(streaming)).toBeLessThanOrEqual(bottomOf(pane))
  expect(streaming.getBoundingClientRect().top).toBeLessThan(0)

  // Faked so d3-zoom’s wheel-idle timer can’t end the gesture while the test waits.
  vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']})
  onTestFinished(() => {
    vi.useRealTimers()
  })
  wheelOnce(-300)
  await reactCaughtUp()
  const scrolled = viewport()

  main.publish({...ids, type: 'TEXT_DELTA', delta: '\n\nA line mid-scroll'})
  await everyFrameUntil(
    () => canvas().getByText('A line mid-scroll').query() !== null
  )
  // The canvas measures the grown Reply as that frame draws.
  await new Promise(requestAnimationFrame)
  await reactCaughtUp()
  expect(viewport()).toBe(scrolled)
  vi.runOnlyPendingTimers()
  vi.useRealTimers()

  main.publish({...ids, type: 'TEXT_DELTA', delta: '\n\nThe last line'})
  await expect.element(canvas().getByText('The last line')).toBeInTheDocument()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  expect(viewport()).toBe(scrolled)

  await wheelGesture(500)
  expect(bottomOf(streaming)).toBeLessThanOrEqual(bottomOf(pane))

  main.publish({...ids, type: 'TEXT_DELTA', delta: `\n\n${longReply}`})
  await expect
    .poll(() => canvas().getByText('Line 40', {exact: true}).elements())
    .toHaveLength(2)
  await expect
    .poll(() => bottomOf(streaming))
    .toBeLessThanOrEqual(bottomOf(pane))
})

it('lets a streaming Reply go when Show more, pressed from the keyboard, lets out the text being read above it', async () => {
  clock = 0

  const {main} = await renderCanvas({
    prompts: [prompt(1, null, 'Prompt one')],
    replies: [reply(11, 1, longReply)],
  })

  await expect.element(page.getByText('Line 40')).toBeInTheDocument()
  await settledViewport()

  await sendInto('Line 40', 'And then?')
  await expect.element(canvas().getByText('Writing…')).toBeVisible()
  await settledViewport()
  const replyId = main.replies.at(-1)?.id

  if (replyId === undefined) throw new Error('No Reply was started')

  const ids = {treeId, replyId}
  main.publish({...ids, type: 'RUN_STARTED'})

  const box = canvas()
    .getByText('Line 12', {exact: true})
    .element()
    .closest('.overflow-y-auto')

  if (!box) throw new Error('Line 12 is not in capped text')

  box.scrollTop = 150
  const before = lineTop('Line 12')

  // A pointer press on the canvas lets the Reply go before the click lands.
  canvas().getByRole('button', {name: 'Show more'}).element().focus()
  await userEvent.keyboard('{Enter}')
  await expect
    .element(canvas().getByRole('button', {name: 'Show less'}))
    .toBeVisible()
  await settledViewport()
  expect(lineTop('Line 12')).toBeCloseTo(before, 0)

  main.publish({
    ...ids,
    type: 'TEXT_DELTA',
    delta: longReply.replaceAll('Line', 'Streamed'),
  })
  await expect.element(canvas().getByText('Streamed 40')).toBeInTheDocument()
  await new Promise(requestAnimationFrame)
  await new Promise(requestAnimationFrame)
  expect(lineTop('Line 12')).toBeCloseTo(before, 0)
})

function deleteButtonOf(promptText: string) {
  return nodeOf(promptText).getByRole('button', {
    name: 'Delete this Prompt and everything below it',
  })
}

function opacityOf(locator: ReturnType<typeof deleteButtonOf>) {
  const shown = locator.element().closest('[data-delete]')

  return shown ? getComputedStyle(shown).opacity : null
}

it('shows a Prompt’s delete control only while the pointer is over it, in both orientations', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()

  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('0')
  await page.getByText('Prompt two').hover()
  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('1')
  await hoverAway()
  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('0')

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(5)
  await hoverAway()
  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('0')
  await page.getByText('Prompt two').hover()
  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('1')
  await page.getByText('Reply two').hover()
  await expect.poll(() => opacityOf(deleteButtonOf('Prompt two'))).toBe('0')
})

async function armDelete(promptText: string) {
  await page.getByText(promptText).hover()
  await deleteButtonOf(promptText).click()
}

function confirmation() {
  return page.getByRole('alertdialog')
}

it('asks in a dialog to delete the Prompt with every Turn below it, and cancels by Cancel or Esc', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await armDelete('Prompt two')
  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete 6 Turns?'}))
    .toBeVisible()
  await confirmation().getByRole('button', {name: 'Cancel'}).click()
  await expect.element(confirmation()).not.toBeInTheDocument()

  await armDelete('Prompt three')
  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete 2 Turns?'}))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation()).not.toBeInTheDocument()

  expect(main.sent.some(command => command.type === 'prompt.delete')).toBe(
    false
  )
})

it('deletes the Prompt and every Turn below it once confirmed, before the Turns are fetched again', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  main.turnsLoads.held = new Promise(() => {})

  await armDelete('Prompt two')
  await confirmation().getByRole('button', {name: 'Delete'}).click()

  await expect.element(page.getByText('Prompt two')).not.toBeInTheDocument()
  expect(main.sent.filter(command => command.type === 'prompt.delete')).toEqual(
    [{type: 'prompt.delete', treeId, promptId: uuid(2)}]
  )

  for (const gone of ['Reply two', 'Prompt four', 'Reply five']) {
    expect(page.getByText(gone).query()).toBeNull()
  }

  await expect.poll(nodeCount).toBe(4)
  await expect.element(page.getByText('Reply three')).toBeVisible()
})

it('shows main’s refusal in the confirmation and keeps every Turn', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  main.deletes.refusal = 'A Reply below is still being written'

  await armDelete('Prompt two')
  await confirmation().getByRole('button', {name: 'Delete'}).click()

  await expect
    .element(confirmation().getByRole('alert'))
    .toHaveTextContent('A Reply below is still being written')
  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete 6 Turns?'}))
    .toBeVisible()
  expect(nodeCount()).toBe(10)
})

function deleteTreeButton() {
  return nodeOf('Prompt one').getByRole('button', {name: 'Delete this Tree'})
}

it('asks to delete the whole Tree from its root Prompt, and deletes the Tree rather than the Prompt once confirmed', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()

  await page.getByText('Prompt one').hover()
  await deleteTreeButton().click()
  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete Tree?'}))
    .toBeVisible()

  await confirmation().getByRole('button', {name: 'Delete'}).click()

  await expect
    .poll(() => main.sent.filter(command => command.type === 'tree.delete'))
    .toEqual([{type: 'tree.delete', treeId}])
  expect(main.sent.some(command => command.type === 'prompt.delete')).toBe(
    false
  )
})

it('shows main’s refusal to delete the Tree in the root Prompt’s confirmation', async () => {
  const {main} = await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  main.deletes.refusal = 'A Reply is still being written'

  await page.getByText('Prompt one').hover()
  await deleteTreeButton().click()
  await confirmation().getByRole('button', {name: 'Delete'}).click()

  await expect
    .element(confirmation().getByRole('alert'))
    .toHaveTextContent('A Reply is still being written')
})

it('offers no delete on a Prompt with a Reply streaming at or below it, but still offers the Tree’s', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(15) ? {...one, status: 'streaming', content: []} : one
  )

  await renderCanvas(saved)
  await expect.element(page.getByText('Prompt five')).toBeVisible()

  await expect.element(deleteButtonOf('Prompt four')).toBeInTheDocument()
  await expect.element(deleteButtonOf('Prompt three')).toBeInTheDocument()

  for (const above of ['Prompt two', 'Prompt five']) {
    expect(deleteButtonOf(above).query()).toBeNull()
  }

  await expect.element(deleteTreeButton()).toBeInTheDocument()
})

async function deleteFrom(promptText: string) {
  await armDelete(promptText)
  await confirmation().getByRole('button', {name: 'Delete'}).click()
  await expect.element(page.getByText(promptText)).not.toBeInTheDocument()
}

it('keeps the Reply a deleted Prompt answered where it is on screen, in both orientations', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()
  const before = rect('Reply two')

  await deleteFrom('Prompt four')
  await settledViewport()
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)

  await page.getByRole('button', {name: 'Horizontal'}).click()
  await expect
    .poll(() => document.querySelectorAll('.react-flow__node-exchange').length)
    .toBe(4)
  await settledViewport()
  const card = rect('Reply one')

  await deleteFrom('Prompt three')
  await settledViewport()
  expect(rect('Reply one').left).toBeCloseTo(card.left, 0)
  expect(rect('Reply one').top).toBeCloseTo(card.top, 0)
})

it('keeps a card put once it stops being a Fork and its pill goes, beside a taller Branch', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(14)
      ? {
          ...one,
          content: [{type: 'text', text: 'Reply four\n\nand on\n\nand on'}],
        }
      : one
  )

  await renderCanvas({...saved, settings: {canvasOrientation: 'horizontal'}})
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await settledViewport()
  const before = rect('Reply two')

  await deleteFrom('Prompt five')
  await expect
    .element(nodeOf('Reply two').getByRole('button', {name: /Branches/}))
    .not.toBeInTheDocument()
  await settledViewport()
  expect(rect('Reply two').left).toBeCloseTo(before.left, 0)
  expect(rect('Reply two').top).toBeCloseTo(before.top, 0)
})

it('moves the Active Thread up to the Reply a deleted Prompt answered, when it ran through the Prompt', async () => {
  await renderCanvas(forkedTree())
  await expect.element(page.getByText('Reply five')).toBeVisible()
  await hoverAway()
  await expect.poll(() => revealed('Reply five')).toBe('true')

  await deleteFrom('Prompt five')
  await hoverAway()
  await expect.poll(() => revealed('Reply two')).toBe('true')
  expect(revealed('Reply four')).toBe('false')

  await clickInputUnder('Reply three')
  await deleteFrom('Prompt four')
  await hoverAway()
  await expect.poll(() => revealed('Reply three')).toBe('true')
  expect(revealed('Reply two')).toBe('false')
})

it('cancels a delete with Esc rather than stopping the Active Thread’s streaming Reply', async () => {
  const saved = forkedTree()

  saved.replies = saved.replies.map(one =>
    one.id === uuid(15) ? {...one, status: 'streaming', content: []} : one
  )

  const {main} = await renderCanvas(saved)
  await expect.element(page.getByText('Prompt five')).toBeVisible()

  await armDelete('Prompt three')
  await expect
    .element(page.getByRole('alertdialog', {name: 'Delete 2 Turns?'}))
    .toBeVisible()
  await userEvent.keyboard('{Escape}')
  await expect.element(confirmation()).not.toBeInTheDocument()

  expect(main.sent.some(command => command.type === 'reply.stop')).toBe(false)
})
