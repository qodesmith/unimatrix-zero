import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'
import type {Locator} from 'vitest/browser'

import {ConnectionsProvider} from '#modules/connections/main'
import {followColorScheme} from '#modules/theme/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {EventSchema} from '@uz/contract/events'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {afterEach, beforeEach, expect, it, onTestFinished, vi} from 'vitest'
import {render} from 'vitest-browser-react'

import recording from '../fake-reply.json'
import {goOffline, goOnline} from '../go-offline'
import {LiveReplies, ReplyView, useTurns} from '../main'

const events: AppEvent[] = recording.map(event => EventSchema.parse(event))

const [first] = events

if (!first || !('replyId' in first)) throw new Error('The recording is empty')

const {treeId, replyId} = first

const reply: Reply = {
  id: replyId,
  treeId,
  promptId: '01a16096-00af-7d3b-8205-6b76ddc26ce0',
  provider: 'claude',
  model: 'fake',
  status: 'streaming',
  content: [],
  contextSize: null,
  contextWindow: null,
  failure: null,
  compacted: false,
  rebuilt: false,
  files: [],
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

let saved: Reply[] = []

function fakeMain() {
  const listeners = new Set<(event: AppEvent) => void>()

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'tree.turns') {
        return {ok: true, value: {prompts: [], replies: [...saved]}}
      }

      if (command.type === 'image.load') {
        return {
          ok: true,
          value: {
            dataUrl:
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        }
      }

      return {
        ok: false,
        error: {code: 'not-found', message: 'Not in this test'},
      }
    }) as Bridge['send'],
    subscribe: listener => {
      listeners.add(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers: [
          {provider: 'claude', status: 'ready', account: null},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        models: {
          claude: [
            {
              id: 'opus',
              name: 'Opus',
              isDefault: true,
              resolvesTo: 'opus-4-7',
              needsAppUpdate: false,
            },
          ],
          chatgpt: [],
        },
        lastModel: null,
        signIn: null,
        settings: DEFAULT_SETTINGS,
        layout: DEFAULT_LAYOUT,
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  return {...bridge, publish}
}

let main = fakeMain()

beforeEach(() => {
  sent.length = 0
  saved = []
  main = fakeMain()
  globalThis.window.uz = main
})

afterEach(() => {
  vi.useRealTimers()
})

function Providers({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ConnectionsProvider>
        <LiveReplies>{children}</LiveReplies>
      </ConnectionsProvider>
    </QueryClientProvider>
  )
}

function SavedReplies() {
  const turns = useTurns(treeId)

  return turns.data?.replies.map(one => <ReplyView key={one.id} reply={one} />)
}

function savedReply(id: string, changes: Partial<Reply>): Reply {
  return {...reply, id, ...changes}
}

async function renderSaved(...replies: Partial<Reply>[]) {
  saved = replies.map((changes, nth) =>
    savedReply(nth === 0 ? replyId : crypto.randomUUID(), changes)
  )

  const screen = await render(<SavedReplies />, {wrapper: Providers})

  await expect
    .element(screen.getByRole('article', {name: 'Reply'}).first())
    .toBeInTheDocument()

  return screen
}

/** The recording's events from main, the clock at 1000 + 100 ms per event. */
function stream(from: number, upTo: number) {
  vi.useFakeTimers({toFake: ['Date']})

  for (const [nth, event] of events.slice(from, upTo).entries()) {
    vi.setSystemTime(1000 + 100 * (from + nth + 1))
    main.publish(event)
  }
}

function before(type: AppEvent['type'], nth = 0) {
  return (
    events.flatMap((event, index) => (event.type === type ? [index] : []))[
      nth
    ] ?? events.length
  )
}

async function replay(upTo = before('RUN_FINISHED')) {
  const screen = await renderSaved({})

  stream(0, upTo)

  return screen
}

function colorOf(text: Locator) {
  return getComputedStyle(text.element()).color
}

function visibleOrder(article: Element) {
  return [
    ...article.querySelectorAll('p, [data-slot="collapsible"], [role="group"]'),
  ].map(node => node.textContent.slice(0, 20))
}

it('shows the thinking live and collapsed, then how long it took', async () => {
  const screen = await replay(before('TEXT_DELTA'))
  const thinking = screen.getByText('Thinking…')

  await expect.element(thinking).toBeVisible()
  await expect.element(screen.getByText(/The user wants/)).not.toBeVisible()

  await thinking.click()
  await expect
    .element(screen.getByText(/The user wants to see the fake Provider/))
    .toBeVisible()

  stream(before('TEXT_DELTA'), before('TOOL_CALL_START'))

  await expect.element(screen.getByText('Thought for 4s')).toBeVisible()
  await expect.element(screen.getByText('Thinking…')).not.toBeInTheDocument()
})

it('shows each Thinking block where it happened', async () => {
  const screen = await replay()
  const article = screen.getByRole('article', {name: 'Reply'}).element()

  await expect.element(screen.getByText(/^Thought for/).nth(1)).toBeVisible()
  await expect.element(screen.getByText('Thinking…')).not.toBeInTheDocument()

  const order = visibleOrder(article)
  const toolAt = order.findIndex(text => text.startsWith('search'))

  const secondThoughtAt = order.findIndex(text =>
    text.includes('The search answe')
  )

  expect(order[0]).toMatch(/^Thought for/)
  expect(secondThoughtAt).toBeGreaterThan(toolAt)
  expect(order.slice(secondThoughtAt + 1).join(' ')).toContain('Found it.')
})

it('renders the tool call inline, between the text before and after it', async () => {
  const screen = await replay()
  const toolCall = screen.getByRole('group', {name: 'Tool call search'})

  await expect.element(toolCall).toBeVisible()
  await expect.element(toolCall.getByText('done')).toBeVisible()

  await toolCall.getByText('search', {exact: true}).click()
  await expect
    .element(toolCall.getByText(/"query": "Show me everything"/))
    .toBeVisible()
  await expect
    .element(toolCall.getByText(/Three canned results\./))
    .toBeVisible()

  const article = screen.getByRole('article', {name: 'Reply'}).element()
  const order = visibleOrder(article)
  const toolAt = order.findIndex(text => text.startsWith('search'))

  expect(order.slice(0, toolAt).join(' ')).toContain('Let me look somethin')
  expect(order.slice(toolAt + 1).join(' ')).toContain('Found it.')
})

it('lists the files a Reply changed as chips under its text, each with what happened to it and the size it was left at', async () => {
  onTestFinished(followColorScheme())

  const screen = await renderSaved({
    status: 'complete',
    content: [{type: 'text', text: 'All written down.'}],
    files: [
      {path: 'notes/plan.md', change: 'created', size: 1200},
      {path: 'src/app.ts', change: 'edited', size: 64},
      {path: 'old.txt', change: 'deleted', size: null},
    ],
  })

  const chips = screen.getByRole('group', {name: 'Files changed'})
  const created = chips.getByRole('group', {name: 'Created notes/plan.md'})
  const deleted = chips.getByRole('group', {name: 'Deleted old.txt'})

  await expect.element(created).toHaveTextContent('plan.mdCreated · 1.2 KiB')
  await expect
    .element(chips.getByRole('group', {name: 'Edited src/app.ts'}))
    .toHaveTextContent('app.tsEdited · 64 bytes')
  await expect.element(deleted).toHaveTextContent('old.txtDeleted')
  expect(colorOf(created.getByText(/^Created ·/))).not.toBe(
    colorOf(deleted.getByText('Deleted', {exact: true}))
  )

  const article = screen.getByRole('article', {name: 'Reply'}).element()
  const order = visibleOrder(article)

  expect(order[0]).toBe('All written down.')
  expect(order[1]).toContain('plan.md')
})

it('shows no chips on a Reply that changed no file, and adds them when main reports its files after it finishes', async () => {
  const screen = await replay(events.length)
  const chips = screen.getByRole('group', {name: 'Files changed'})

  await expect
    .element(screen.getByRole('article', {name: 'Reply'}))
    .toHaveAttribute('aria-busy', 'false')
  await expect.element(chips).not.toBeInTheDocument()

  main.publish({
    type: 'FILES_CHANGED',
    treeId,
    replyId,
    files: [{path: 'notes.txt', change: 'created', size: 5}],
  })

  await expect
    .element(chips.getByRole('group', {name: 'Created notes.txt'}))
    .toBeVisible()
})

it('shows the tool call as running until its result arrives', async () => {
  const screen = await replay(before('TOOL_RESULT'))

  await expect
    .element(
      screen
        .getByRole('group', {name: 'Tool call search'})
        .getByText('running…')
    )
    .toBeVisible()
})

it('shows a tool call with no result as cut off, not as an error, once its Reply has stopped or been interrupted', async () => {
  const content: Reply['content'] = [
    {
      type: 'tool-call',
      toolCallId: 'tool-1',
      toolName: 'Bash',
      args: '{"command":"sleep 600"}',
      result: null,
    },
    {
      type: 'tool-call',
      toolCallId: 'tool-2',
      toolName: 'Read',
      args: '{"file_path":"missing.txt"}',
      result: {content: 'No such file', isError: true},
    },
  ]

  onTestFinished(followColorScheme())

  const screen = await renderSaved(
    {status: 'stopped', content},
    {status: 'interrupted', content}
  )

  for (const nth of [0, 1]) {
    const cutOff = screen.getByRole('group', {name: 'Tool call Bash'}).nth(nth)
    const failed = screen.getByRole('group', {name: 'Tool call Read'}).nth(nth)

    await expect.element(cutOff.getByText('cut off')).toBeVisible()
    await expect.element(failed.getByText('failed')).toBeVisible()
    expect(colorOf(cutOff.getByText('Bash', {exact: true}))).not.toBe(
      colorOf(failed.getByText('Read', {exact: true}))
    )
  }
})

it('highlights the code block', async () => {
  const screen = await replay()
  const code = screen.getByRole('article').element().querySelector('pre code')

  await expect
    .poll(() => code?.querySelectorAll('span').length)
    .toBeGreaterThan(2)
})

it('draws the Mermaid diagram once its bundle has loaded', async () => {
  const screen = await replay()
  const article = screen.getByRole('article').element()

  await expect
    .poll(() => article.querySelector('svg [class*="node"]')?.textContent, {
      timeout: 15_000,
    })
    .toContain('Prompt')
}, 20_000)

function imageLoads() {
  return sent.filter(command => command.type === 'image.load')
}

it('shows a remote image as a chip, and loads it through main on a click', async () => {
  const screen = await replay()
  const chip = screen.getByText('Image from example.com')

  await expect.element(chip).toBeVisible()
  expect(screen.getByRole('article').element().querySelector('img')).toBeNull()
  expect(imageLoads()).toEqual([])

  await screen.getByRole('button', {name: 'Load'}).click()

  expect(imageLoads()).toEqual([
    {type: 'image.load', url: 'https://example.com/fake-reply-path.png'},
  ])
  await expect
    .element(screen.getByRole('img', {name: "The Reply's path, as a picture"}))
    .toBeVisible()
})

it('says why an image could not load, and offers to try again', async () => {
  globalThis.window.uz = {
    ...main,
    send: (async (command: Command) =>
      command.type === 'image.load'
        ? {
            ok: false,
            error: {
              code: 'handler-failed',
              message: 'The image could not be loaded (404).',
            },
          }
        : main.send(command)) as Bridge['send'],
  }
  const screen = await replay()

  await screen.getByRole('button', {name: 'Load'}).click()

  await expect
    .element(screen.getByText('The image could not be loaded (404).'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', {name: 'Try again'}))
    .toBeVisible()
})

it('shows the Provider’s icon and the name of the Model the Reply was written on', async () => {
  const screen = await renderSaved({status: 'complete', model: 'opus-4-7'})
  const article = screen.getByRole('article', {name: 'Reply'})

  await expect.element(article.getByRole('img', {name: 'Claude'})).toBeVisible()
  await expect.element(article.getByText('Opus', {exact: true})).toBeVisible()
})

it('shows the Model’s id when its Provider doesn’t list it', async () => {
  const screen = await renderSaved({status: 'complete', model: 'sonnet-3'})

  await expect
    .element(screen.getByText('sonnet-3', {exact: true}))
    .toBeVisible()
})

it('draws no Stop in a streaming Reply’s content', async () => {
  const screen = await replay(before('TOOL_CALL_START'))
  const article = screen.getByRole('article', {name: 'Reply'})

  await expect.element(article.getByText('Writing…')).toBeVisible()
  expect(article.getByRole('button', {name: /Stop/}).query()).toBeNull()
})

it('offers no Retry on a Reply the app quit on: it goes on like a stopped one', async () => {
  const screen = await renderSaved({status: 'interrupted'})

  await expect
    .element(screen.getByText('Interrupted when the app quit'))
    .toBeVisible()
  expect(screen.getByRole('button', {name: 'Retry'}).query()).toBeNull()
})

const COMPACTED =
  'Compacted here. The AI remembers earlier Turns from a summary.'

it('marks a streaming Reply once its Compaction arrives, and keeps the mark when it finishes', async () => {
  const screen = await replay(before('TOOL_CALL_START'))
  const marker = screen.getByText(COMPACTED)

  await expect.element(screen.getByText('Writing…')).toBeVisible()
  expect(marker.query()).toBeNull()

  main.publish({
    treeId,
    replyId,
    type: 'CONTEXT_COMPACTED',
    sessionId: 'session-1',
    boundaryId: null,
  })

  await expect.element(marker).toBeVisible()

  stream(before('TOOL_CALL_START'), events.length)

  await expect.element(screen.getByText('Writing…')).not.toBeInTheDocument()
  await expect.element(marker).toBeVisible()
})

it('says a Reply re-read the whole conversation, and says nothing on another', async () => {
  const screen = await renderSaved({rebuilt: true}, {rebuilt: false})

  await expect
    .element(screen.getByText('Re-read the whole conversation to go on'))
    .toBeVisible()
  expect(
    screen.getByText('Re-read the whole conversation to go on').all()
  ).toHaveLength(1)
})

it('shows Reconnecting… in place of Writing… from a reconnect until the next content, keeping the text so far', async () => {
  const screen = await replay(before('TOOL_CALL_START'))
  const article = screen.getByRole('article', {name: 'Reply'})

  main.publish({treeId, replyId, type: 'RECONNECTING', busy: false})

  await expect.element(article.getByText('Reconnecting…')).toBeVisible()
  expect(article.getByText('Writing…').query()).toBeNull()
  await expect
    .element(article.getByText(/Let me look something up/))
    .toBeVisible()

  stream(before('TOOL_CALL_START'), before('TOOL_CALL_START') + 1)

  await expect.element(article.getByText('Writing…')).toBeVisible()
  expect(article.getByText('Reconnecting…').query()).toBeNull()
})

it('shows Busy, retrying… while the latest retry is for a busy server, under the offline label, until the next content', async () => {
  const screen = await replay(before('TOOL_CALL_START'))
  const article = screen.getByRole('article', {name: 'Reply'})

  main.publish({treeId, replyId, type: 'RECONNECTING', busy: true})

  await expect.element(article.getByText('Busy, retrying…')).toBeVisible()
  expect(article.getByText('Writing…').query()).toBeNull()

  goOffline()

  await expect
    .element(article.getByText('Offline · waiting for the connection'))
    .toBeVisible()
  expect(article.getByText('Busy, retrying…').query()).toBeNull()

  goOnline()
  main.publish({treeId, replyId, type: 'RECONNECTING', busy: true})

  await expect.element(article.getByText('Busy, retrying…')).toBeVisible()

  main.publish({treeId, replyId, type: 'RECONNECTING', busy: false})

  await expect.element(article.getByText('Reconnecting…')).toBeVisible()
  expect(article.getByText('Busy, retrying…').query()).toBeNull()

  main.publish({treeId, replyId, type: 'RECONNECTING', busy: true})
  stream(before('TOOL_CALL_START'), before('TOOL_CALL_START') + 1)

  await expect.element(article.getByText('Writing…')).toBeVisible()
  expect(article.getByText('Busy, retrying…').query()).toBeNull()
})

it('says a streaming Reply is offline while the OS says so, then Reconnecting… until the next content', async () => {
  const screen = await replay(before('TOOL_CALL_START'))
  const article = screen.getByRole('article', {name: 'Reply'})

  goOffline()

  await expect
    .element(article.getByText('Offline · waiting for the connection'))
    .toBeVisible()
  expect(article.getByText('Writing…').query()).toBeNull()

  goOnline()

  await expect.element(article.getByText('Reconnecting…')).toBeVisible()
  expect(article.getByText(/Offline/).query()).toBeNull()

  stream(before('TOOL_CALL_START'), before('TOOL_CALL_START') + 1)

  await expect.element(article.getByText('Writing…')).toBeVisible()
})
