import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {ProviderStatus} from '@uz/contract/providers'
import type {Reply, RunFailure} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {ConnectionsProvider} from '#modules/connections/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {EventSchema} from '@uz/contract/events'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {beforeEach, expect, it, onTestFinished} from 'vitest'
import {render} from 'vitest-browser-react'

import recording from '../fake-reply.json'
import {createReplay} from '../replay'
import {ReplyStoreContext} from '../use-live-reply'
import {ReplyView} from './ReplyView'

/** The fake driver's Reply, as `record-fake-reply` recorded it. */
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
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

/**
 * Main as a Reply sees it: `image.load` on a click, `reply.stop` and
 * `reply.retry` from its buttons, and Claude's status in the SNAPSHOT.
 */
function fakeMain(claude: ProviderStatus['status'] = 'ready'): Bridge {
  return {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'image.load') {
        return {
          ok: true,
          value: {
            dataUrl:
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        }
      }

      if (command.type === 'reply.stop') return {ok: true, value: {}}

      if (command.type === 'reply.retry') {
        return {
          ok: true,
          value: {reply: {...reply, status: 'streaming', content: []}},
        }
      }

      return {
        ok: false,
        error: {code: 'not-found', message: 'Not in this test'},
      }
    }) as Bridge['send'],
    subscribe: listener => {
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers: [
          {provider: 'claude', status: claude, account: null},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        signIn: null,
        settings: DEFAULT_SETTINGS,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }
}

const main = fakeMain()

beforeEach(() => {
  sent.length = 0
  globalThis.window.uz = main
})

function Providers({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <ConnectionsProvider>{children}</ConnectionsProvider>
    </QueryClientProvider>
  )
}

function before(type: AppEvent['type'], nth = 0) {
  return (
    events.flatMap((event, index) => (event.type === type ? [index] : []))[
      nth
    ] ?? events.length
  )
}

/**
 * Renders the Reply and replays the fake driver's events into it, up to the
 * end by default: `RUN_FINISHED` hands the Reply to the saved Turns, which
 * `<TreeView>` reads and this test does not.
 */
async function replay(upTo = before('RUN_FINISHED')) {
  const live = createReplay()

  const screen = await render(
    <ReplyStoreContext value={live.store}>
      <ReplyView reply={reply} />
    </ReplyStoreContext>,
    {wrapper: Providers}
  )

  live.replay(events.slice(0, upTo))

  return screen
}

/** A saved Reply, as the Tree's Turns hold it, with nothing streaming. */
async function renderSaved(changes: Partial<Reply>) {
  const live = createReplay()

  return render(
    <ReplyStoreContext value={live.store}>
      <ReplyView reply={{...reply, ...changes}} />
    </ReplyStoreContext>,
    {wrapper: Providers}
  )
}

function failed(failure: RunFailure): Partial<Reply> {
  return {
    status: 'failed',
    content: [{type: 'text', text: 'Half an answer'}],
    failure,
  }
}

/**
 * The Reply's paragraphs, thinking and tool calls in page order, by their first
 * words.
 */
function visibleOrder(article: Element) {
  return [...article.querySelectorAll('p, details')].map(node =>
    node.textContent.slice(0, 20)
  )
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
})

it('replaces the thinking header with its duration once the words start', async () => {
  const screen = await replay(before('TOOL_CALL_START'))

  await expect.element(screen.getByText(/^Thought for \d+s$/)).toBeVisible()
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

it('highlights the code block', async () => {
  const screen = await replay()
  const code = screen.getByRole('article').element().querySelector('pre code')

  await expect
    .poll(() => code?.querySelectorAll('span').length)
    .toBeGreaterThan(2)
  expect(code?.textContent).toBe('const answer = 42')
})

it('renders the math with KaTeX', async () => {
  const screen = await replay()
  const article = screen.getByRole('article').element()

  await expect.poll(() => article.querySelectorAll('.katex').length).toBe(2)
  expect(article.querySelector('.katex-display')).not.toBeNull()
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

it('shows a remote image as a chip, and loads it through main on a click', async () => {
  const screen = await replay()
  const chip = screen.getByText('Image from example.com')

  await expect.element(chip).toBeVisible()
  expect(screen.getByRole('article').element().querySelector('img')).toBeNull()
  expect(sent).toEqual([])

  await screen.getByRole('button', {name: 'Load'}).click()

  expect(sent).toEqual([
    {type: 'image.load', url: 'https://example.com/fake-reply-path.png'},
  ])
  await expect
    .element(screen.getByRole('img', {name: "The Reply's path, as a picture"}))
    .toBeVisible()
})

it('says why an image could not load, and offers to try again', async () => {
  globalThis.window.uz = {
    ...main,
    send: async () => ({
      ok: false,
      error: {
        code: 'handler-failed',
        message: 'The image could not be loaded (404).',
      },
    }),
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

it('says a stopped Reply was stopped, keeping its text', async () => {
  const screen = await renderSaved({
    status: 'stopped',
    content: [{type: 'text', text: 'Half an answer'}],
  })

  await expect.element(screen.getByText('Half an answer')).toBeVisible()
  await expect
    .element(screen.getByText('Stopped'))
    .toHaveClass('text-muted-foreground')
})

it('says an interrupted Reply was cut short by the app quitting', async () => {
  const screen = await renderSaved({
    status: 'interrupted',
    content: [{type: 'text', text: 'Half an answer'}],
  })

  await expect
    .element(screen.getByText('Interrupted when the app quit'))
    .toHaveClass('text-muted-foreground')
})

it.each([
  [{code: 'connection-lost', message: 'ECONNRESET'}, 'Connection lost'],
  [
    {code: 'program-crashed', message: 'exit 137'},
    'Claude stopped unexpectedly',
  ],
  [{code: 'host-crashed', message: 'exit 1'}, 'Claude stopped unexpectedly'],
  [{code: 'disk-full', message: 'ENOSPC'}, 'Disk full'],
  [
    {code: 'host-unreachable', message: 'no reply in 5s'},
    'Claude could not be reached',
  ],
  [
    {code: 'provider-error', message: 'Overloaded, try again later'},
    'Overloaded, try again later',
  ],
  [{code: 'driver-error', message: 'Bad frame'}, 'Bad frame'],
  [{code: 'fake-failure', message: 'Asked to fail'}, 'Asked to fail'],
] satisfies [RunFailure, string][])(
  'says why a Reply failed: %o reads "%s"',
  async (failure, line) => {
    const screen = await renderSaved(failed(failure))

    await expect.element(screen.getByText('Half an answer')).toBeVisible()
    await expect.element(screen.getByText(line)).toHaveClass('text-destructive')
    expect(screen.getByText('This Reply failed.').query()).toBeNull()
  }
)

it('says when a reached limit lifts, in local time', async () => {
  const screen = await renderSaved(
    failed({
      code: 'limit-reached',
      message: '5-hour limit',
      resetsAt: '2026-10-19T15:05:00.000Z',
    })
  )

  await expect
    .element(screen.getByText(/^Limit reached · resets at \d{1,2}:\d{2}/))
    .toHaveClass('text-destructive')
})

it('says only that the limit was reached when the Provider gave no reset time', async () => {
  const screen = await renderSaved(
    failed({code: 'limit-reached', message: '5-hour limit'})
  )

  await expect.element(screen.getByText('Limit reached')).toBeVisible()
})

it('stops a streaming Reply from its button, which waits as Stopping… until the Reply ends', async () => {
  const live = createReplay()

  const screen = await render(
    <ReplyStoreContext value={live.store}>
      <ReplyView reply={reply} />
    </ReplyStoreContext>,
    {wrapper: Providers}
  )

  live.replay(events.slice(0, before('TOOL_CALL_START')))

  await expect.element(screen.getByText('Writing…')).toBeVisible()
  await screen.getByRole('button', {name: 'Stop'}).click()

  expect(sent).toEqual([{type: 'reply.stop', treeId, replyId}])
  await expect
    .element(screen.getByRole('button', {name: 'Stopping…'}))
    .toBeDisabled()

  live.replay([{type: 'RUN_FINISHED', treeId, replyId, status: 'stopped'}])
  await screen.rerender(
    <ReplyStoreContext value={live.store}>
      <ReplyView
        reply={{
          ...reply,
          status: 'stopped',
          content: [{type: 'text', text: 'Let me look'}],
        }}
      />
    </ReplyStoreContext>
  )

  await expect.element(screen.getByText('Stopped')).toBeVisible()
  expect(screen.getByRole('button', {name: /Stop/}).query()).toBeNull()
})

const lost: RunFailure = {code: 'connection-lost', message: 'ECONNRESET'}

it('retries a failed Reply in place: it streams again from nothing', async () => {
  const live = createReplay()

  const screen = await render(
    <ReplyStoreContext value={live.store}>
      <ReplyView reply={{...reply, ...failed(lost)}} />
    </ReplyStoreContext>,
    {wrapper: Providers}
  )

  await expect.element(screen.getByText('Connection lost')).toBeVisible()
  await screen.getByRole('button', {name: 'Retry'}).click()

  expect(sent).toEqual([{type: 'reply.retry', treeId, replyId}])

  live.replay([{type: 'RUN_STARTED', treeId, replyId}])
  await expect.element(screen.getByText('Writing…')).toBeVisible()
  expect(screen.getByText('Half an answer').query()).toBeNull()
  expect(screen.getByText('Connection lost').query()).toBeNull()
})

it('offers no Retry on a Reply the app quit on: it goes on like a stopped one', async () => {
  const screen = await renderSaved({status: 'interrupted'})

  await expect
    .element(screen.getByText('Interrupted when the app quit'))
    .toBeVisible()
  expect(screen.getByRole('button', {name: 'Retry'}).query()).toBeNull()
})

it('shows why main refused a retry, beside the button', async () => {
  globalThis.window.uz = {
    ...main,
    send: async () => ({
      ok: false,
      error: {code: 'handler-failed', message: 'Connect Claude to retry.'},
    }),
  }
  const screen = await renderSaved(failed(lost))

  await screen.getByRole('button', {name: 'Retry'}).click()

  await expect
    .element(screen.getByText('Connect Claude to retry.'))
    .toBeVisible()
  await expect
    .element(screen.getByRole('button', {name: 'Retry'}))
    .toBeEnabled()
})

/** The browser's view of the connection, as `navigator.onLine` reports it. */
function goOffline() {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => false,
  })
  globalThis.dispatchEvent(new Event('offline'))
  onTestFinished(() => {
    goOnline()
  })
}

function goOnline() {
  Reflect.deleteProperty(navigator, 'onLine')
  globalThis.dispatchEvent(new Event('online'))
}

it('holds Retry while offline, saying so, and frees it once the connection is back', async () => {
  goOffline()
  const screen = await renderSaved(failed(lost))
  const retry = screen.getByRole('button', {name: 'Retry'})

  await expect.element(retry).toBeDisabled()
  await expect
    .element(screen.getByText('Offline · Retry waits for the connection'))
    .toBeVisible()

  goOnline()
  await expect.element(retry).toBeEnabled()
  expect(screen.getByText(/Offline/).query()).toBeNull()
})

it.each([
  ['signed-out', 'Sign in to Claude again to retry'],
  ['not-connected', 'Connect Claude to retry'],
  ['starting', 'Claude is starting…'],
  ['restarting', 'Claude is starting…'],
  ['failed', "Claude isn't running"],
] satisfies [ProviderStatus['status'], string][])(
  'holds Retry while Claude is %s: "%s"',
  async (status, reason) => {
    globalThis.window.uz = fakeMain(status)
    const screen = await renderSaved(failed(lost))

    await expect
      .element(screen.getByRole('button', {name: 'Retry'}))
      .toBeDisabled()
    await expect.element(screen.getByText(reason)).toBeVisible()
  }
)

it('gates every failed Reply on one subscription to main', async () => {
  let subscriptions = 0
  globalThis.window.uz = {
    ...main,
    subscribe: listener => {
      subscriptions += 1

      return main.subscribe(listener)
    },
  }
  const live = createReplay()

  const screen = await render(
    <ReplyStoreContext value={live.store}>
      <ReplyView reply={{...reply, ...failed(lost)}} />
      <ReplyView reply={{...reply, ...failed(lost), id: crypto.randomUUID()}} />
    </ReplyStoreContext>,
    {wrapper: Providers}
  )

  await expect
    .element(screen.getByRole('button', {name: 'Retry'}).nth(1))
    .toBeEnabled()
  expect(subscriptions).toBe(1)
})
