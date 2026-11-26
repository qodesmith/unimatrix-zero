import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {ApprovalAction} from '@uz/contract/permissions'
import type {ApprovalAnswer, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {ConnectionsProvider} from '#modules/connections/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {PRESETS} from '@uz/contract/system-prompts'
import {beforeEach, expect, it} from 'vitest'
import {render} from 'vitest-browser-react'

import {LiveReplies, ReplyView, useTurns} from '../main'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const replyId = '01a16096-00b0-7d3b-8205-6b76ddc26ce0'
const ids = {treeId, replyId}

const OUTSIDE =
  'This happens outside the conversation, so other Branches will see it too.'

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
  systemPromptId: '019ab3c0-5e1f-7000-8000-000000000001',
  files: [],
  createdAt: '2026-10-19T12:00:00.000Z',
}

const sent: Command[] = []

/** Each answer waits here until the test lets it through. */
let answering: {resolve: () => void} | null = null

function fakeMain() {
  const listeners = new Set<(event: AppEvent) => void>()

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'tree.turns') {
        return {ok: true, value: {prompts: [], replies: [reply]}}
      }

      if (command.type === 'reply.answer-approval') {
        await new Promise<void>(resolve => {
          answering = {resolve}
        })

        return {ok: true, value: {}}
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
        approvals: [],
        providers: [
          {provider: 'claude', status: 'ready', account: null},
          {provider: 'chatgpt', status: 'not-connected', account: null},
        ],
        models: {claude: [], chatgpt: []},
        lastModel: null,
        signIn: null,
        settings: DEFAULT_SETTINGS,
        systemPrompts: {entries: [...PRESETS]},
        layout: DEFAULT_LAYOUT,
      })

      return () => listeners.delete(listener)
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  function publish(...events: AppEvent[]) {
    for (const event of events) {
      for (const listener of listeners) listener(event)
    }
  }

  return {...bridge, publish}
}

let main = fakeMain()

beforeEach(() => {
  sent.length = 0
  answering = null
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

function SavedReplies() {
  const turns = useTurns(treeId)

  return turns.data?.replies.map(one => <ReplyView key={one.id} reply={one} />)
}

async function renderReply(...events: AppEvent[]) {
  const screen = await render(<SavedReplies />, {wrapper: Providers})

  await expect
    .element(screen.getByRole('article', {name: 'Reply'}))
    .toBeInTheDocument()
  main.publish({...ids, type: 'RUN_STARTED'}, ...events)

  return screen
}

function asked(
  action: ApprovalAction,
  extra: {subagentId?: string; toolCallId?: string} = {}
): AppEvent {
  return {
    ...ids,
    ...extra,
    type: 'APPROVAL_REQUESTED',
    approvalId: 'approval-1',
    action,
  }
}

function card(screen: Awaited<ReturnType<typeof renderReply>>) {
  return screen.getByRole('group', {name: 'Approval card'})
}

it.each([
  [{kind: 'command', command: 'rm -rf build'}, 'rm -rf build'],
  [
    {kind: 'host', host: 'example.com'},
    'The AI wants to connect to example.com',
  ],
  [
    {kind: 'mcp-tool', server: 'github', tool: 'create_issue'},
    'The AI wants to use create_issue from github',
  ],
  [
    {kind: 'edit', paths: ['/Users/sam/.zshrc'], inTreeFiles: false},
    'The AI wants to edit /Users/sam/.zshrc',
  ],
] satisfies [ApprovalAction, string][])(
  'says what the AI wants to do, and that it lands outside the conversation: %o',
  async (action, words) => {
    const screen = await renderReply(asked(action))

    await expect.element(card(screen).getByText(words)).toBeVisible()
    await expect.element(card(screen).getByText(OUTSIDE)).toBeVisible()
  }
)

const UNSANDBOXED =
  'Outside the Sandbox, it could read and change any of your files, use your saved logins and reach the internet.'

it('leads a command that would leave the Sandbox with what it could then reach, which a command inside it leaves out', async () => {
  const screen = await renderReply(
    asked({kind: 'command', command: 'rm -rf build', outsideSandbox: true})
  )

  await expect
    .element(
      card(screen).getByText(
        'The AI wants to run this command on your whole computer'
      )
    )
    .toBeVisible()
  await expect.element(card(screen).getByText('rm -rf build')).toBeVisible()
  await expect.element(card(screen).getByText(UNSANDBOXED)).toBeVisible()

  main.publish({
    ...ids,
    type: 'APPROVAL_REQUESTED',
    approvalId: 'approval-2',
    action: {kind: 'command', command: 'ls'},
  })

  await expect
    .element(
      screen.getByText('The AI wants to run this command', {exact: true})
    )
    .toBeVisible()
  expect(screen.getByText(UNSANDBOXED).all()).toHaveLength(1)
})

it('says the Reply waits for you while a card waits, not that it is writing', async () => {
  const screen = await renderReply()

  await expect.element(screen.getByText('Writing…')).toBeVisible()

  main.publish(asked({kind: 'command', command: 'ls'}))

  await expect.element(screen.getByText('Waiting for you')).toBeVisible()
  expect(screen.getByText('Writing…').query()).toBeNull()

  main.publish({
    ...ids,
    type: 'APPROVAL_RESOLVED',
    approvalId: 'approval-1',
    answer: 'allow-once',
  })

  await expect.element(screen.getByText('Writing…')).toBeVisible()
})

it('names the file an edit inside the Tree’s files would change, and leaves out the outside line', async () => {
  const screen = await renderReply(
    asked({
      kind: 'edit',
      paths: ['/trees/one/notes/plan.md', '/trees/one/todo.md'],
      inTreeFiles: true,
    })
  )

  await expect
    .element(card(screen).getByText('The AI wants to edit plan.md and todo.md'))
    .toBeVisible()
  expect(screen.getByText(OUTSIDE).query()).toBeNull()
})

it('names the Subagent asking', async () => {
  const screen = await renderReply(
    {
      ...ids,
      type: 'SUBAGENT_STARTED',
      subagentId: 'subagent-1',
      description: 'Look for the bug',
    },
    asked({kind: 'command', command: 'ls'}, {subagentId: 'subagent-1'})
  )

  await expect
    .element(card(screen).getByText('Asked by a Subagent: Look for the bug'))
    .toBeVisible()
})

it.each([
  ['Allow once', 'allow-once', '✓ allowed'],
  ['Always allow in this Tree', 'always-allow', '✓ allowed'],
  ['Deny', 'deny', '✕ denied'],
] satisfies [string, ApprovalAnswer, string][])(
  '%s sends %s, holds the buttons while it goes, and the card collapses to %s once answered',
  async (button, answer, chip) => {
    const screen = await renderReply(asked({kind: 'command', command: 'ls'}))

    await card(screen).getByRole('button', {name: button}).click()

    expect(sent.filter(one => one.type === 'reply.answer-approval')).toEqual([
      {
        type: 'reply.answer-approval',
        treeId,
        replyId,
        approvalId: 'approval-1',
        answer,
      },
    ])

    for (const name of ['Allow once', 'Always allow in this Tree', 'Deny']) {
      await expect
        .element(card(screen).getByRole('button', {name}))
        .toBeDisabled()
    }

    answering?.resolve()
    main.publish({
      ...ids,
      type: 'APPROVAL_RESOLVED',
      approvalId: 'approval-1',
      answer,
    })

    await expect.element(screen.getByText(chip, {exact: true})).toBeVisible()
    expect(card(screen).query()).toBeNull()
  }
)

it('puts the card right after the tool call it asks about', async () => {
  const screen = await renderReply(
    {...ids, type: 'TEXT_DELTA', delta: 'Before the tool.'},
    {...ids, type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolName: 'Bash'},
    {...ids, type: 'TEXT_DELTA', delta: 'After the tool.'},
    asked({kind: 'command', command: 'ls'}, {toolCallId: 'tool-1'})
  )

  const tool = screen.getByRole('group', {name: 'Tool call Bash'}).element()
  const after = screen.getByText('After the tool.').element()
  const asking = card(screen).element()

  const order = [...document.querySelectorAll('*')]

  expect(order.indexOf(asking)).toBeGreaterThan(order.indexOf(tool))
  expect(order.indexOf(after)).toBeGreaterThan(order.indexOf(asking))
})

const reviewing: AppEvent = {
  ...ids,
  type: 'REVIEW_STARTED',
  reviewId: 'review-1',
  action: {kind: 'host', host: 'example.com'},
}

function reviewed(
  decision: 'approved' | 'declined' | 'unanswered',
  reason: string | null
): AppEvent {
  return {
    ...ids,
    type: 'REVIEW_FINISHED',
    reviewId: 'review-1',
    decision,
    reason,
  }
}

it('says Reviewing… while the Reviewer decides, then shows its approval collapsed, opening to the action and its reason', async () => {
  const screen = await renderReply(reviewing)

  await expect.element(screen.getByText('Reviewing…')).toBeVisible()

  main.publish(reviewed('approved', 'Reading docs is safe.'))

  const chip = screen.getByText('✓ approved by reviewer')

  await expect.element(chip).toBeVisible()
  expect(screen.getByText('Reviewing…').query()).toBeNull()
  await expect
    .element(screen.getByText('Reading docs is safe.'))
    .not.toBeVisible()

  await chip.click()

  await expect.element(screen.getByText('Reading docs is safe.')).toBeVisible()
  await expect
    .element(screen.getByText('The AI wanted to connect to example.com'))
    .toBeVisible()
})

it.each([
  ['declined', 'Sends your files away.', 'Sends your files away.'],
  ['unanswered', 'timeout', "Reviewer didn't answer"],
] as const)(
  'shows a review %s as declined by reviewer, with its reason, and no way to allow it anyway',
  async (decision, reason, shown) => {
    const screen = await renderReply(reviewing, reviewed(decision, reason))

    await expect
      .element(screen.getByText('✕ declined by reviewer'))
      .toBeVisible()
    await expect.element(screen.getByText(shown)).toBeVisible()
    expect(screen.getByRole('button', {name: /allow/i}).query()).toBeNull()
  }
)
