import type {AppEvent} from '@uz/contract/events'
import type {ReplyEvent} from '@uz/contract/turns'

import {openDatabase} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import path from 'node:path'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {PARTIAL_SAVE_MS, createTurns} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let published: AppEvent[]
let turns: ReturnType<typeof createTurns>
let treeId: string
let replyId: string

beforeEach(() => {
  vi.useFakeTimers()
  const db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  turns = createTurns(db, event => published.push(event))
  treeId = createTrees(db).create(new Date()).id
  replyId = turns.start({
    treeId,
    parentReplyId: null,
    text: 'Hi',
    provider: 'claude',
    model: 'fake',
    systemPrompt: '',
    now: new Date(),
  }).reply.id
})

afterEach(() => {
  vi.useRealTimers()
})

type Without<T> = T extends unknown ? Omit<T, 'treeId' | 'replyId'> : never

function apply(event: Without<ReplyEvent>) {
  turns.apply('claude', {...event, treeId, replyId})
}

function saved() {
  const [reply] = turns.list(treeId).replies

  if (!reply) throw new Error('The Reply was not saved')

  return reply
}

it('saves the Reply as streaming when it starts', () => {
  expect(saved()).toMatchObject({status: 'streaming', content: []})
})

it('saves partial text about every second, not on every word', () => {
  apply({type: 'TEXT_DELTA', delta: 'Hello '})
  apply({type: 'TEXT_DELTA', delta: 'there'})

  expect(saved().content).toEqual([])

  vi.advanceTimersByTime(PARTIAL_SAVE_MS)

  expect(saved().content).toEqual([{type: 'text', text: 'Hello there'}])
})

it('saves partial text at once when the app quits, leaving no timer', () => {
  apply({type: 'TEXT_DELTA', delta: 'Half a'})

  turns.saveAll()

  expect(saved()).toMatchObject({
    status: 'streaming',
    content: [{type: 'text', text: 'Half a'}],
  })
  expect(vi.getTimerCount()).toBe(0)
})

it('saves each part as soon as it finishes', () => {
  apply({type: 'TEXT_DELTA', delta: 'Looking.'})
  apply({type: 'TOOL_CALL_START', toolCallId: 't1', toolName: 'search'})

  expect(saved().content).toEqual([
    {type: 'text', text: 'Looking.'},
    {
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'search',
      args: '',
      result: null,
    },
  ])

  apply({type: 'TOOL_RESULT', toolCallId: 't1', content: 'ok', isError: false})

  expect(saved().content[1]).toMatchObject({
    result: {content: 'ok', isError: false},
  })
})

it('saves the end as complete with the Context size and the Context window', () => {
  apply({type: 'TEXT_DELTA', delta: 'Done.'})
  apply({type: 'TOKENS', inputTokens: 3, outputTokens: 2, contextSize: 5})
  apply({type: 'RUN_FINISHED', status: 'complete', contextWindow: 200_000})

  expect(saved()).toMatchObject({
    status: 'complete',
    content: [{type: 'text', text: 'Done.'}],
    contextSize: 5,
    contextWindow: 200_000,
  })
  expect(turns.streaming()).toEqual([])
})

it('publishes each event after saving what it needed to', () => {
  apply({type: 'TEXT_DELTA', delta: 'Hi'})
  apply({type: 'RUN_FINISHED', status: 'complete'})

  expect(published.map(event => event.type)).toEqual([
    'TEXT_DELTA',
    'RUN_FINISHED',
  ])
})

it('keeps what each Reply shows for a window that connects mid-stream', () => {
  apply({type: 'TEXT_DELTA', delta: 'Half a '})
  apply({type: 'TEXT_DELTA', delta: 'sentence'})

  expect(turns.streaming()).toEqual([
    {
      treeId,
      replyId,
      status: 'streaming',
      content: [{type: 'text', text: 'Half a sentence'}],
      contextSize: null,
      contextWindow: null,
      failure: null,
    },
  ])
})

it('drops events from a host that is not writing the Reply', () => {
  turns.apply('chatgpt', {type: 'TEXT_DELTA', treeId, replyId, delta: 'x'})

  expect(published).toEqual([])
  expect(turns.streaming()[0]?.content).toEqual([])
})

it('fails a crashed host’s Replies with the text they last showed', () => {
  apply({type: 'TEXT_DELTA', delta: 'Cut off mid'})

  turns.failAll('claude', {code: 'host-crashed', message: 'Claude stopped.'})

  expect(saved()).toMatchObject({
    status: 'failed',
    content: [{type: 'text', text: 'Cut off mid'}],
  })
  expect(published.at(-1)).toEqual({
    type: 'RUN_FINISHED',
    treeId,
    replyId,
    status: 'failed',
    failure: {code: 'host-crashed', message: 'Claude stopped.'},
  })
  expect(turns.streaming()).toEqual([])
})

it('saves why the Reply failed, and lists it with the Reply', () => {
  apply({type: 'TEXT_DELTA', delta: 'Half'})
  apply({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'connection-lost', message: 'Connection lost.'},
  })

  expect(saved()).toMatchObject({
    status: 'failed',
    content: [{type: 'text', text: 'Half'}],
    failure: {code: 'connection-lost', message: 'Connection lost.'},
  })
})

it('marks a Reply left streaming by the last run as interrupted at launch', () => {
  apply({type: 'TEXT_DELTA', delta: 'Half a'})
  turns.saveAll()
  const db = openDatabase({file: ':memory:', migrationsFolder})
  const left = createTrees(db).create(new Date()).id
  const before = createTurns(db, () => undefined)
  before.start({
    treeId: left,
    parentReplyId: null,
    text: 'Hi',
    provider: 'claude',
    model: 'fake',
    systemPrompt: '',
    now: new Date(),
  })

  const relaunched = createTurns(db, () => undefined)

  const [interrupted] = relaunched.list(left).replies

  expect(interrupted).toMatchObject({status: 'interrupted', failure: null})
  // Like a stopped one: the Thread goes on, in a new session for a root Reply.
  expect(relaunched.continuation(left, interrupted?.id ?? '')).toEqual({
    provider: 'claude',
    session: null,
  })
  expect(saved().status).toBe('streaming')
})

it('starts a failed Reply over from nothing, streaming again in place', () => {
  apply({type: 'TEXT_DELTA', delta: 'Half'})
  apply({type: 'TOKENS', inputTokens: 3, outputTokens: 2, contextSize: 5})
  apply({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'host-crashed', message: 'Claude stopped.'},
  })

  const reply = turns.restart(replyId)

  expect(reply).toMatchObject({
    id: replyId,
    status: 'streaming',
    content: [],
    contextSize: null,
    failure: null,
  })
  expect(saved()).toEqual(reply)
  expect(turns.writer(treeId, replyId)).toBe('claude')
  expect(turns.streaming()).toEqual([
    {
      treeId,
      replyId,
      status: 'streaming',
      content: [],
      contextSize: null,
      contextWindow: null,
      failure: null,
    },
  ])
})

it('knows which host is writing a Reply, and when none is', () => {
  expect(turns.writer(treeId, replyId)).toBe('claude')
  expect(() => turns.writer(crypto.randomUUID(), replyId)).toThrow(
    'That Reply isn’t being written.'
  )

  apply({type: 'RUN_FINISHED', status: 'complete'})

  expect(() => turns.writer(treeId, replyId)).toThrow(
    'That Reply isn’t being written.'
  )
})
