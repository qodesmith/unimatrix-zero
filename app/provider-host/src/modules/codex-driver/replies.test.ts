import type {Notification} from './wire'

import {expect, it} from 'vitest'

import {createReplyMapper} from './replies'

const ids = {treeId: crypto.randomUUID(), replyId: crypto.randomUUID()}
const inTurn = {threadId: 'thread', turnId: 'turn'}

function delta(itemId: string, text: string): Notification {
  return {
    method: 'item/agentMessage/delta',
    params: {...inTurn, itemId, delta: text},
  }
}

function message(id: string, text: string): Notification {
  return {
    method: 'item/completed',
    params: {...inTurn, item: {type: 'agentMessage', id, text}},
  }
}

it('replaces what streamed when the finished message differs', () => {
  const mapper = createReplyMapper(ids)

  expect([
    ...mapper.map(delta('a', 'Hel')),
    ...mapper.map(delta('a', 'lo')),
    ...mapper.map(message('a', 'Hello!')),
  ]).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: 'Hel'},
    {...ids, type: 'TEXT_DELTA', delta: 'lo'},
    {...ids, type: 'TEXT_REPLACE', text: 'Hello!'},
  ])
})

it('replaces only the last message, after the ones before it', () => {
  const mapper = createReplyMapper(ids)
  mapper.map(message('a', 'One. '))
  mapper.map(delta('b', 'Tw'))

  expect(mapper.map(message('b', 'Two.'))).toEqual([
    {...ids, type: 'TEXT_REPLACE', text: 'One. Two.'},
  ])
})

it('adds a message that never streamed, and leaves one that matches', () => {
  const mapper = createReplyMapper(ids)

  expect(mapper.map(message('a', 'Hi'))).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: 'Hi'},
  ])
  expect(mapper.map(message('a', 'Hi'))).toEqual([])
})

it('passes reasoning on and reads each request’s own token count', () => {
  const mapper = createReplyMapper(ids)

  const usage = {
    totalTokens: 120,
    inputTokens: 100,
    cachedInputTokens: 80,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 5,
  }

  expect([
    ...mapper.map({
      method: 'item/reasoning/summaryTextDelta',
      params: {...inTurn, delta: 'Thinking'},
    }),
    ...mapper.map({
      method: 'thread/tokenUsage/updated',
      params: {
        ...inTurn,
        tokenUsage: {total: usage, last: usage, modelContextWindow: 475_000},
      },
    }),
  ]).toEqual([
    {...ids, type: 'REASONING_DELTA', delta: 'Thinking'},
    {
      ...ids,
      type: 'TOKENS',
      inputTokens: 100,
      outputTokens: 20,
      contextSize: 120,
      contextWindow: 475_000,
    },
  ])
})

it('leaves the context window out when Codex has none to report', () => {
  const usage = {totalTokens: 120, inputTokens: 100, outputTokens: 20}

  expect(
    createReplyMapper(ids).map({
      method: 'thread/tokenUsage/updated',
      params: {
        ...inTurn,
        tokenUsage: {total: usage, last: usage, modelContextWindow: null},
      },
    })
  ).toStrictEqual([
    {
      ...ids,
      type: 'TOKENS',
      inputTokens: 100,
      outputTokens: 20,
      contextSize: 120,
    },
  ])
})

it.each([
  ['completed', null, {status: 'complete'}],
  ['interrupted', null, {status: 'stopped'}],
  [
    'failed',
    {message: 'To use Codex with your ChatGPT plan, upgrade to Plus.'},
    {
      status: 'failed',
      failure: {
        code: 'provider-error',
        message: 'To use Codex with your ChatGPT plan, upgrade to Plus.',
      },
    },
  ],
  [
    'failed',
    {message: 'You’ve hit your usage limit. Resets at 2026-10-24T15:00:00Z.'},
    {
      status: 'failed',
      failure: {
        code: 'limit-reached',
        message: 'You’ve hit your usage limit. Resets at 2026-10-24T15:00:00Z.',
        resetsAt: '2026-10-24T15:00:00.000Z',
      },
    },
  ],
  [
    'failed',
    {message: 'stream disconnected before completion: connection reset'},
    {
      status: 'failed',
      failure: {
        code: 'connection-lost',
        message: 'stream disconnected before completion: connection reset',
      },
    },
  ],
  [
    'failed',
    null,
    {
      status: 'failed',
      failure: {
        code: 'provider-error',
        message: 'ChatGPT couldn’t finish this Reply.',
      },
    },
  ],
] as const)('ends a %s turn', (status, error, ended) => {
  expect(createReplyMapper(ids).finished({id: 'turn', status, error})).toEqual({
    ...ids,
    type: 'RUN_FINISHED',
    ...ended,
  })
})
