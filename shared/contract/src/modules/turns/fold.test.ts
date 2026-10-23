import type {ReplyEvent} from './schemas'

import {expect, it} from 'vitest'

import {NEW_REPLY, foldReplyEvent} from './fold'

const ids = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
}

type Without<T> = T extends unknown ? Omit<T, 'treeId' | 'replyId'> : never

function fold(...events: Without<ReplyEvent>[]) {
  return events.reduce(
    (reply, event) => foldReplyEvent(reply, {...ids, ...event}),
    NEW_REPLY
  )
}

it('joins text deltas into one text part', () => {
  expect(
    fold(
      {type: 'RUN_STARTED'},
      {type: 'TEXT_DELTA', delta: 'Hello '},
      {type: 'TEXT_DELTA', delta: 'world'}
    ).content
  ).toEqual([{type: 'text', text: 'Hello world'}])
})

it('replaces the current text part when the stream is re-sent', () => {
  expect(
    fold(
      {type: 'TEXT_DELTA', delta: 'Hel'},
      {type: 'TEXT_REPLACE', text: 'Hello again'}
    ).content
  ).toEqual([{type: 'text', text: 'Hello again'}])
})

it('puts a tool call between the text around it', () => {
  const reply = fold(
    {type: 'TEXT_DELTA', delta: 'Looking.'},
    {type: 'TOOL_CALL_START', toolCallId: 't1', toolName: 'search'},
    {type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"q":'},
    {type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '"x"}'},
    {type: 'TOOL_CALL_END', toolCallId: 't1'},
    {type: 'TOOL_RESULT', toolCallId: 't1', content: 'found', isError: false},
    {type: 'TEXT_DELTA', delta: 'Done.'}
  )

  expect(reply.content).toEqual([
    {type: 'text', text: 'Looking.'},
    {
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'search',
      args: '{"q":"x"}',
      result: {content: 'found', isError: false},
    },
    {type: 'text', text: 'Done.'},
  ])
})

it('takes the Context size the Provider reports and the final status', () => {
  expect(
    fold(
      {type: 'TOKENS', inputTokens: 10, outputTokens: 5, contextSize: 15},
      {type: 'RUN_FINISHED', status: 'complete'}
    )
  ).toEqual({
    status: 'complete',
    content: [],
    contextSize: 15,
    contextWindow: null,
  })
})

it('keeps the Context window from whichever event reports it', () => {
  expect(
    fold(
      {
        type: 'TOKENS',
        inputTokens: 10,
        outputTokens: 5,
        contextSize: 15,
        contextWindow: 200_000,
      },
      {type: 'TOKENS', inputTokens: 12, outputTokens: 6, contextSize: 18},
      {type: 'RUN_FINISHED', status: 'complete'}
    ).contextWindow
  ).toBe(200_000)

  expect(
    fold(
      {type: 'TOKENS', inputTokens: 10, outputTokens: 5, contextSize: 15},
      {type: 'RUN_FINISHED', status: 'complete', contextWindow: 272_000}
    ).contextWindow
  ).toBe(272_000)
})

it('keeps thinking and Subagent work out of the Reply’s content', () => {
  const before = fold({type: 'TEXT_DELTA', delta: 'Hi'})

  expect(
    foldReplyEvent(before, {...ids, type: 'REASONING_DELTA', delta: 'hmm'})
  ).toBe(before)
  expect(
    foldReplyEvent(before, {
      ...ids,
      subagentId: 's1',
      type: 'TEXT_DELTA',
      delta: 'from a Subagent',
    })
  ).toBe(before)
})
