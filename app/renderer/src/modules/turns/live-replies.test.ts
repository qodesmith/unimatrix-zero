import type {Turns} from './saved-turns'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it} from 'vitest'

import {markStreamingWaiting} from './live-replies'
import {createReplay} from './replay'
import {turnsKey} from './saved-turns'

const ids = {treeId: 'tree-1', replyId: 'reply-1'}

function thinkingAfter(events: AppEvent[]) {
  const live = createReplay()

  live.replay(events)

  return live.store.state.thinking[ids.replyId] ?? []
}

const tokens: AppEvent = {
  ...ids,
  type: 'TOKENS',
  inputTokens: 1,
  outputTokens: 1,
  contextSize: 2,
}

it('keeps one Thinking block open across a token report', () => {
  const blocks = thinkingAfter([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'First '},
    tokens,
    {...ids, type: 'REASONING_DELTA', delta: 'and second.'},
  ])

  expect(blocks).toEqual([
    {text: 'First and second.', beforePart: 0, startedAt: 1200, endedAt: null},
  ])
})

it('closes the block once the words start, and opens another before the next part', () => {
  const blocks = thinkingAfter([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'Before the words.'},
    {...ids, type: 'TEXT_DELTA', delta: 'Hello'},
    {...ids, type: 'REASONING_DELTA', delta: 'Before the tool.'},
    {...ids, type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolName: 'search'},
  ])

  expect(blocks).toEqual([
    {text: 'Before the words.', beforePart: 0, startedAt: 1200, endedAt: 1300},
    {text: 'Before the tool.', beforePart: 1, startedAt: 1400, endedAt: 1500},
  ])
})

it('keeps a Subagent’s thinking and words from touching the Reply’s Thinking block', () => {
  const subagent = {...ids, subagentId: 'subagent-1'}

  const blocks = thinkingAfter([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'The Reply’s.'},
    {...subagent, type: 'REASONING_DELTA', delta: 'The Subagent’s.'},
    {...subagent, type: 'TEXT_DELTA', delta: 'Its words.'},
  ])

  expect(blocks).toEqual([
    {text: 'The Reply’s.', beforePart: 0, startedAt: 1200, endedAt: null},
  ])
})

const saved: Reply = {
  id: ids.replyId,
  treeId: ids.treeId,
  promptId: 'prompt-1',
  provider: 'claude',
  model: 'fake',
  status: 'streaming',
  content: [],
  contextSize: null,
  contextWindow: null,
  failure: null,
  compacted: false,
  rebuilt: false,
  createdAt: '2026-10-19T12:00:00.000Z',
}

it('moves a failed Reply into the saved Turns with its text so far and why it failed', () => {
  const live = createReplay()
  const key = turnsKey(ids.treeId)

  live.queryClient.setQueryData<Turns>(key, {prompts: [], replies: [saved]})
  live.replay([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'TEXT_DELTA', delta: 'Half a'},
    {
      ...ids,
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'connection-lost', message: 'The stream ended early'},
    },
  ])

  expect(live.queryClient.getQueryData<Turns>(key)?.replies).toEqual([
    {
      ...saved,
      status: 'failed',
      content: [{type: 'text', text: 'Half a'}],
      failure: {code: 'connection-lost', message: 'The stream ended early'},
    },
  ])
  expect(live.store.state.replies[ids.replyId]).toBeUndefined()
})

it('starts a retried Reply over, dropping the thinking of its first run', () => {
  const blocks = thinkingAfter([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'The first try.'},
    {...ids, type: 'TEXT_DELTA', delta: 'Hel'},
    {
      ...ids,
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'connection-lost', message: 'The stream ended early'},
    },
    {...ids, type: 'RUN_STARTED'},
  ])

  expect(blocks).toEqual([])
})

it('keeps a Stop asked before a retried run starts until that run finishes', () => {
  const live = createReplay()

  live.store.setState(state => ({
    ...state,
    runs: {[ids.replyId]: {status: 'stopping'}},
  }))
  live.replay([{...ids, type: 'RUN_STARTED'}])

  expect(live.store.state.runs[ids.replyId]).toEqual({status: 'stopping'})

  live.replay([{...ids, type: 'RUN_FINISHED', status: 'stopped'}])

  expect(live.store.state.runs[ids.replyId]).toBeUndefined()
})

function waitsAfter(events: AppEvent[]) {
  const live = createReplay()

  live.replay(events)

  return live.store.state.waiting[ids.replyId]
}

const reconnecting: AppEvent = {...ids, type: 'RECONNECTING', busy: false}
const busy: AppEvent = {...ids, type: 'RECONNECTING', busy: true}

it('keeps a Reply waiting from a reconnect, through a token report', () => {
  expect(
    waitsAfter([
      {...ids, type: 'RUN_STARTED'},
      {...ids, type: 'TEXT_DELTA', delta: 'Half a'},
      reconnecting,
      tokens,
    ])
  ).toBe('reconnecting')
})

it('waits as busy or reconnecting by the latest retry', () => {
  const started: AppEvent = {...ids, type: 'RUN_STARTED'}

  expect(waitsAfter([started, reconnecting, busy])).toBe('busy')
  expect(waitsAfter([started, busy, reconnecting])).toBe('reconnecting')
})

it.each([
  {...ids, type: 'TEXT_DELTA', delta: 'line'},
  {...ids, type: 'TEXT_REPLACE', text: 'Half a line'},
  {...ids, type: 'REASONING_DELTA', delta: 'Hmm'},
  {...ids, type: 'TOOL_CALL_START', toolCallId: 'tool-2', toolName: 'search'},
  {...ids, type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{'},
  {
    ...ids,
    type: 'TOOL_RESULT',
    toolCallId: 'tool-1',
    content: 'Found',
    isError: false,
  },
  {...ids, type: 'RUN_STARTED'},
  {...ids, type: 'RUN_FINISHED', status: 'complete'},
] satisfies AppEvent[])('stops waiting at the next $type', event => {
  expect(
    waitsAfter([
      {...ids, type: 'RUN_STARTED'},
      {
        ...ids,
        type: 'TOOL_CALL_START',
        toolCallId: 'tool-1',
        toolName: 'search',
      },
      busy,
      event,
    ])
  ).toBeUndefined()
})

const other = {treeId: 'tree-2', replyId: 'reply-2'}

it('marks every streaming Reply waiting, and no finished one', () => {
  const live = createReplay()

  live.replay([
    {...ids, type: 'RUN_STARTED'},
    {...other, type: 'RUN_STARTED'},
    {...other, type: 'RUN_FINISHED', status: 'complete'},
  ])
  markStreamingWaiting(live.store)

  expect(live.store.state.waiting).toEqual({[ids.replyId]: 'reconnecting'})
})

it('keeps a Reply waiting across a snapshot only while the snapshot still streams it', () => {
  const live = createReplay()

  live.replay([
    {...ids, type: 'RUN_STARTED'},
    {...other, type: 'RUN_STARTED'},
  ])
  markStreamingWaiting(live.store)

  const kept = live.store.state.replies[ids.replyId]

  if (!kept) throw new Error('The Reply is not streaming')

  live.replay([
    {
      type: 'SNAPSHOT',
      app: {version: '0.0.0'},
      replies: [kept],
      providers: [],
      models: {claude: [], chatgpt: []},
      lastModel: null,
      signIn: null,
      settings: DEFAULT_SETTINGS,
      layout: DEFAULT_LAYOUT,
    },
  ])

  expect(live.store.state.waiting).toEqual({[ids.replyId]: 'reconnecting'})
})
