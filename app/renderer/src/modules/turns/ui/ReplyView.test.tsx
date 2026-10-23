import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'

import {QueryClient} from '@tanstack/react-query'
import {EventSchema} from '@uz/contract/events'
import {beforeEach, expect, it} from 'vitest'
import {render} from 'vitest-browser-react'

import recording from '../fake-reply.json'
import {applyLiveEvent, createReplyStore} from '../live-replies'
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
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

/** Only `image.load` reaches main from a Reply, and only on a click. */
const main: Bridge = {
  send: (async (command: Command) => {
    sent.push(command)

    return command.type === 'image.load'
      ? {
          ok: true,
          value: {
            dataUrl:
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
          },
        }
      : {ok: false, error: {code: 'not-found', message: 'Not in this test'}}
  }) as Bridge['send'],
  subscribe: () => () => undefined,
  registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
}

beforeEach(() => {
  sent.length = 0
  globalThis.window.uz = main
})

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
  const store = createReplyStore()
  const queryClient = new QueryClient()
  let now = 1000

  const screen = await render(
    <ReplyStoreContext value={store}>
      <ReplyView reply={reply} />
    </ReplyStoreContext>
  )

  for (const event of events.slice(0, upTo)) {
    now += 100
    applyLiveEvent(event, store, queryClient, () => now)
  }

  return screen
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

it('shows each round of thinking where it happened', async () => {
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
