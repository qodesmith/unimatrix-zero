import type {Turns} from './saved-turns'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'

import {expect, it} from 'vitest'

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
