import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {ProviderStatus} from '@uz/contract/providers'
import type {Reply, RunFailure} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {ConnectionsProvider} from '#modules/connections/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {beforeEach, expect, it, onTestFinished} from 'vitest'
import {render} from 'vitest-browser-react'

import {FailedChip, LiveReplies, useTurns} from '../main'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const replyId = '01a16096-00b0-7d3b-8205-6b76ddc26ce0'

const reply: Reply = {
  id: replyId,
  treeId,
  promptId: '01a16096-00af-7d3b-8205-6b76ddc26ce0',
  provider: 'claude',
  model: 'fake',
  status: 'failed',
  content: [],
  contextSize: null,
  contextWindow: null,
  failure: null,
  compacted: false,
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

let saved: Reply[] = []

function fakeMain(claude: ProviderStatus['status'] = 'ready') {
  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'tree.turns') {
        return {ok: true, value: {prompts: [], replies: [...saved]}}
      }

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
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers: [
          {provider: 'claude', status: claude, account: null},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        models: {claude: [], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: DEFAULT_SETTINGS,
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return bridge
}

let main = fakeMain()

beforeEach(() => {
  sent.length = 0
  saved = []
  main = fakeMain()
  globalThis.window.uz = main
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

function FailedReplies() {
  const turns = useTurns(treeId)

  return turns.data?.replies.flatMap(one =>
    one.status === 'failed' ? [<FailedChip key={one.id} reply={one} />] : []
  )
}

function savedReply(id: string, changes: Partial<Reply>): Reply {
  return {...reply, id, ...changes}
}

async function renderSaved(...replies: Partial<Reply>[]) {
  saved = replies.map((changes, nth) =>
    savedReply(nth === 0 ? replyId : crypto.randomUUID(), changes)
  )

  const screen = await render(<FailedReplies />, {wrapper: Providers})

  await expect
    .element(screen.getByRole('group', {name: 'Failed Reply'}).first())
    .toBeInTheDocument()

  return screen
}

function failed(failure: RunFailure): Partial<Reply> {
  return {
    status: 'failed',
    content: [{type: 'text', text: 'Half an answer'}],
    failure,
  }
}

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
  [
    {code: 'needs-app-update', message: 'Model needs Codex 0.50'},
    'Needs an app update',
  ],
] satisfies [RunFailure, string][])(
  'says why a Reply failed, and nothing it wrote: %o reads "%s"',
  async (failure, line) => {
    const screen = await renderSaved(failed(failure))

    await expect.element(screen.getByText(line)).toBeVisible()
    expect(screen.getByText('Half an answer').query()).toBeNull()
  }
)

it('says only that a Reply failed when it has no reason', async () => {
  const screen = await renderSaved({
    status: 'failed',
    content: [{type: 'text', text: 'Half an answer'}],
    failure: null,
  })

  await expect.element(screen.getByText('Failed', {exact: true})).toBeVisible()
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
    .element(screen.getByText(/^Limit reached · resets at /))
    .toMatchTextContent(/at (20|0?8):35\b/u)
})

it('says only that the limit was reached when the Provider gave no reset time', async () => {
  const screen = await renderSaved(
    failed({code: 'limit-reached', message: '5-hour limit'})
  )

  await expect.element(screen.getByText('Limit reached')).toBeVisible()
})

it('says how far a Prompt ran over the Provider’s cap, and offers no Retry', async () => {
  const screen = await renderSaved(
    failed({
      code: 'too-long',
      message: 'Input exceeds the maximum length of 1048576 characters.',
      promptChars: 1_240_000,
      maxPromptChars: 1_048_576,
    })
  )

  await expect
    .element(screen.getByText(/^Prompt too long · /))
    .toMatchTextContent(/· 1\D240\D000 characters, limit 1\D048\D576$/u)
  expect(screen.getByRole('button', {name: 'Retry'}).query()).toBeNull()
})

it('says the Prompt was too long for the Context window, and offers no Retry', async () => {
  const screen = await renderSaved(
    failed({code: 'too-long', message: 'Prompt is too long'})
  )

  await expect
    .element(screen.getByText('Too long for the Context window'))
    .toBeVisible()
  expect(screen.getByRole('button', {name: 'Retry'}).query()).toBeNull()
})

const lost: RunFailure = {code: 'connection-lost', message: 'ECONNRESET'}

it('retries a failed Reply in place, and gives way once main runs it again', async () => {
  const screen = await renderSaved(failed(lost))

  await expect.element(screen.getByText('Connection lost')).toBeVisible()
  await screen.getByRole('button', {name: 'Retry'}).click()

  expect(sent.filter(command => command.type === 'reply.retry')).toEqual([
    {type: 'reply.retry', treeId, replyId},
  ])
  await expect
    .element(screen.getByRole('group', {name: 'Failed Reply'}))
    .not.toBeInTheDocument()
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
