import type {Notification} from './wire'

import {expect, it} from 'vitest'

import {createTurnMapper} from './replies'

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
  const mapper = createTurnMapper(ids)

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
  const mapper = createTurnMapper(ids)
  mapper.map(message('a', 'One. '))
  mapper.map(delta('b', 'Tw'))

  expect(mapper.map(message('b', 'Two.'))).toEqual([
    {...ids, type: 'TEXT_REPLACE', text: 'One. Two.'},
  ])
})

it('adds a message that never streamed, and leaves one that matches', () => {
  const mapper = createTurnMapper(ids)

  expect(mapper.map(message('a', 'Hi'))).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: 'Hi'},
  ])
  expect(mapper.map(message('a', 'Hi'))).toEqual([])
})

it('passes reasoning on and reads each request’s own token count', () => {
  const mapper = createTurnMapper(ids)

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
      params: {...inTurn, tokenUsage: {total: usage, last: usage}},
    }),
  ]).toEqual([
    {...ids, type: 'REASONING_DELTA', delta: 'Thinking'},
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
] as const)('ends a %s turn', (status, error, ended) => {
  expect(createTurnMapper(ids).finished({id: 'turn', status, error})).toEqual({
    ...ids,
    type: 'RUN_FINISHED',
    ...ended,
  })
})
