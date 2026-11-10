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

it('drops an unfinished message once the next one starts, and ignores its late delta and finish', () => {
  const mapper = createReplyMapper(ids)
  mapper.map(delta('a', 'One. '))
  mapper.map(message('a', 'One. '))
  mapper.map(delta('b', 'Silver Moon\n1\n'))

  expect(mapper.map(delta('c', 'Silver Dawn'))).toEqual([
    {...ids, type: 'TEXT_REPLACE', text: 'One. Silver Dawn'},
  ])
  expect(mapper.map(delta('c', '\n1'))).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: '\n1'},
  ])
  expect(mapper.map(delta('b', '2'))).toEqual([])
  expect(mapper.map(message('b', 'Silver Moon\n1\n2'))).toEqual([])
  expect(mapper.map(message('c', 'Silver Dawn\n1!'))).toEqual([
    {...ids, type: 'TEXT_REPLACE', text: 'One. Silver Dawn\n1!'},
  ])
})

it('drops an unfinished message for one that arrives already finished', () => {
  const mapper = createReplyMapper(ids)
  mapper.map(delta('a', 'Silver Moon\n1\n'))

  expect(mapper.map(message('b', 'Silver Dawn\n1'))).toEqual([
    {...ids, type: 'TEXT_REPLACE', text: 'Silver Dawn\n1'},
  ])
})

it('keeps every finished message as the next one starts', () => {
  const mapper = createReplyMapper(ids)
  mapper.map(delta('a', 'One.'))
  mapper.map(message('a', 'One.'))

  expect(mapper.map(delta('b', ' Two.'))).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: ' Two.'},
  ])

  mapper.map(message('b', ' Two.'))

  expect(mapper.map(message('c', ' Three.'))).toEqual([
    {...ids, type: 'TEXT_DELTA', delta: ' Three.'},
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

  const last = {
    totalTokens: 120,
    inputTokens: 100,
    cachedInputTokens: 80,
    cacheWriteInputTokens: 0,
    outputTokens: 20,
    reasoningOutputTokens: 5,
  }

  const total = {
    totalTokens: 360,
    inputTokens: 300,
    cachedInputTokens: 240,
    cacheWriteInputTokens: 0,
    outputTokens: 60,
    reasoningOutputTokens: 15,
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
        tokenUsage: {total, last, modelContextWindow: 475_000},
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

it('ends a turn that overran the Context window as too long', () => {
  // Hand-built from the pinned protocol: nobody has made Codex send one.
  const turn = {
    id: 'turn',
    status: 'failed',
    error: {
      message: 'Codex ran out of room in the model’s context window.',
      codexErrorInfo: 'contextWindowExceeded',
      additionalDetails: null,
    },
  } as const

  expect(createReplyMapper(ids).finished(turn)).toMatchObject({
    status: 'failed',
    failure: {
      code: 'too-long',
      message: 'Codex ran out of room in the model’s context window.',
    },
  })
})

it('names when a limit lifts as Codex reported it apart from the message', () => {
  const turn = {
    id: 'turn',
    status: 'failed',
    error: {message: 'You’ve hit your usage limit.'},
  } as const

  expect(createReplyMapper(ids).finished(turn, 1793970000)).toEqual({
    ...ids,
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {
      code: 'limit-reached',
      message: 'You’ve hit your usage limit.',
      resetsAt: '2026-11-06T13:00:00.000Z',
    },
  })
})
