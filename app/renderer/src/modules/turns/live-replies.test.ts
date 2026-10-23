import type {AppEvent} from '@uz/contract/events'

import {QueryClient} from '@tanstack/react-query'
import {expect, it} from 'vitest'

import {applyLiveEvent, createReplyStore} from './live-replies'

const ids = {treeId: 'tree-1', replyId: 'reply-1'}

function replay(events: AppEvent[]) {
  const store = createReplyStore()
  const queryClient = new QueryClient()
  let now = 1000

  for (const event of events) {
    now += 100
    applyLiveEvent(event, store, queryClient, () => now)
  }

  return store.state.thinking[ids.replyId] ?? []
}

const tokens: AppEvent = {
  ...ids,
  type: 'TOKENS',
  inputTokens: 1,
  outputTokens: 1,
  contextSize: 2,
}

it('keeps one round of thinking open across a token report', () => {
  const summaries = replay([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'First '},
    tokens,
    {...ids, type: 'REASONING_DELTA', delta: 'and second.'},
  ])

  expect(summaries).toEqual([
    {text: 'First and second.', beforePart: 0, startedAt: 1200, endedAt: null},
  ])
})

it('closes the round once the words start, and opens another before the next part', () => {
  const summaries = replay([
    {...ids, type: 'RUN_STARTED'},
    {...ids, type: 'REASONING_DELTA', delta: 'Before the words.'},
    {...ids, type: 'TEXT_DELTA', delta: 'Hello'},
    {...ids, type: 'REASONING_DELTA', delta: 'Before the tool.'},
    {...ids, type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolName: 'search'},
  ])

  expect(summaries).toEqual([
    {text: 'Before the words.', beforePart: 0, startedAt: 1200, endedAt: 1300},
    {text: 'Before the tool.', beforePart: 1, startedAt: 1400, endedAt: 1500},
  ])
})
