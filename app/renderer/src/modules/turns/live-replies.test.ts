import type {AppEvent} from '@uz/contract/events'

import {expect, it} from 'vitest'

import {createReplay} from './replay'

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
