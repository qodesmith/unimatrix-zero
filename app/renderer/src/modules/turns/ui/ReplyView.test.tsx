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
import {afterEach, beforeEach, expect, it, onTestFinished, vi} from 'vitest'
import {render} from 'vitest-browser-react'

import recording from '../fake-reply.json'
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
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

/** The Tree's saved Replies, as main answers `tree.turns`. */
let saved: Reply[] = []

function fakeMain(claude: ProviderStatus['status'] = 'ready') {
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

      if (command.type === 'reply.stop') return {ok: true, value: {}}

      if (command.type === 'reply.retry') {
        const again: Reply = {
          ...reply,
          status: 'streaming',
          content: [],
          failure: null,
        }

        saved = saved.map(one => (one.id === command.replyId ? again : one))

        return {ok: true, value: {reply: again}}
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
          {provider: 'claude', status: claude, account: null},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        signIn: null,
        settings: DEFAULT_SETTINGS,
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

/** Every saved Reply of the Tree, as the canvas shows them. */
function SavedReplies() {
  const turns = useTurns(treeId)

  return turns.data?.replies.map(one => <ReplyView key={one.id} reply={one} />)
}

function savedReply(id: string, changes: Partial<Reply>): Reply {
  return {...reply, id, ...changes}
}

/** Saves the Replies, then renders them once main has handed them over. */
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

/** Events from main, the clock moving 100 ms per event from 1000. */
function stream(published: AppEvent[]) {
  vi.useFakeTimers({toFake: ['Date']})

  for (const [nth, event] of published.entries()) {
    vi.setSystemTime(1000 + 100 * (nth + 1))
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

/** Stops before `RUN_FINISHED`, so the Reply is still streaming. */
async function replay(upTo = before('RUN_FINISHED')) {
  const screen = await renderSaved({})

  stream(events.slice(0, upTo))

  return screen
}

function failed(failure: RunFailure): Partial<Reply> {
  return {
    status: 'failed',
    content: [{type: 'text', text: 'Half an answer'}],
    failure,
  }
}

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
  }
)

it('says only that a Reply failed when it has no reason', async () => {
  const screen = await renderSaved({
    status: 'failed',
    content: [{type: 'text', text: 'Half an answer'}],
    failure: null,
  })

  await expect
    .element(screen.getByText('Failed', {exact: true}))
    .toHaveClass('text-destructive')
})

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
  const screen = await replay(before('TOOL_CALL_START'))

  await expect.element(screen.getByText('Writing…')).toBeVisible()
  await screen.getByRole('button', {name: 'Stop'}).click()

  expect(sent.filter(command => command.type === 'reply.stop')).toEqual([
    {type: 'reply.stop', treeId, replyId},
  ])
  await expect
    .element(screen.getByRole('button', {name: 'Stopping…'}))
    .toBeDisabled()

  main.publish({type: 'RUN_FINISHED', treeId, replyId, status: 'stopped'})

  await expect.element(screen.getByText('Stopped')).toBeVisible()
  await expect.element(screen.getByText(/Let me look/)).toBeVisible()
  expect(screen.getByRole('button', {name: /Stop/}).query()).toBeNull()
})

const lost: RunFailure = {code: 'connection-lost', message: 'ECONNRESET'}

it('retries a failed Reply in place: it streams again from nothing', async () => {
  const screen = await renderSaved(failed(lost))

  await expect.element(screen.getByText('Connection lost')).toBeVisible()
  await screen.getByRole('button', {name: 'Retry'}).click()

  expect(sent.filter(command => command.type === 'reply.retry')).toEqual([
    {type: 'reply.retry', treeId, replyId},
  ])

  main.publish({type: 'RUN_STARTED', treeId, replyId})
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
    send: (async (command: Command) =>
      command.type === 'reply.retry'
        ? {
            ok: false,
            error: {
              code: 'handler-failed',
              message: 'Connect Claude to retry.',
            },
          }
        : main.send(command)) as Bridge['send'],
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
    main = fakeMain(status)
    globalThis.window.uz = main
    const screen = await renderSaved(failed(lost))

    await expect
      .element(screen.getByRole('button', {name: 'Retry'}))
      .toBeDisabled()
    await expect.element(screen.getByText(reason)).toBeVisible()
  }
)

it('gates every failed Reply on one subscription to the Provider statuses', async () => {
  let subscriptions = 0
  globalThis.window.uz = {
    ...main,
    subscribe: listener => {
      subscriptions += 1

      return main.subscribe(listener)
    },
  }
  const screen = await renderSaved(failed(lost), failed(lost))

  await expect
    .element(screen.getByRole('button', {name: 'Retry'}).nth(1))
    .toBeEnabled()
  // One for the live Replies, one for the Provider statuses.
  expect(subscriptions).toBe(2)
})
