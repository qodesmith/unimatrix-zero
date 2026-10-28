import type {Database} from '#modules/database/main'
import type {ReplyHosts} from './main'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {openDatabase} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {PARTIAL_SAVE_MS, createTurns} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const vendorProgram = {program: null, configDir: '/claude'}

const createdAt = new Date('2026-10-19T12:00:00.000Z')

let db: Database
let published: AppEvent[]
let hostCommands: HostCommand[]
let hostReady: boolean
let hostReachable: boolean
let turns: ReturnType<typeof createTurns>
let treeId: string

/** The Claude host, recording what it's asked; the only one that can be ready. */
const hosts: ReplyHosts = {
  ready: only =>
    hostReady && (only ?? 'claude') === 'claude'
      ? {provider: 'claude', model: {id: 'fake', name: 'Fake model'}}
      : null,
  send: (_provider, command) => {
    if (!hostReachable) throw new Error('The claude host is not running.')

    hostCommands.push(command)
  },
}

function launch() {
  return createTurns({
    db,
    publish: event => published.push(event),
    hosts,
    vendorProgramFor: () => vendorProgram,
    now: () => createdAt,
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  hostCommands = []
  hostReady = true
  hostReachable = true
  turns = launch()
  treeId = createTrees(db).create(createdAt).id
})

afterEach(() => {
  vi.useRealTimers()
})

/** The new Reply's id, with the host's commands so far cleared. */
function sendPrompt(parentReplyId: string | null, text = 'Hi') {
  const sent = turns.sendPrompt({treeId, parentReplyId, text})

  if (!sent) throw new Error('The Reply it answers is gone')

  hostCommands = []

  return sent.reply.id
}

type Without<T> = T extends unknown ? Omit<T, 'treeId' | 'replyId'> : never

function fromHost(replyId: string, event: Without<ReplyEvent>) {
  turns.hostEvent('claude', {...event, treeId, replyId})
}

function record(replyId: string) {
  turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'claude-haiku-5-5',
    session: {sessionId: 's1', messageId: 'm1'},
  })
}

function recordPrompt(replyId: string, messageId: string, sessionId = 's1') {
  turns.hostPromptRecorded('claude', {
    type: 'PROMPT_RECORDED',
    treeId,
    replyId,
    session: {sessionId, messageId},
  })
}

function finish(replyId: string) {
  fromHost(replyId, {type: 'RUN_FINISHED', status: 'complete'})
}

/** A root Reply the Provider saved, finished. */
function savedRoot() {
  const replyId = sendPrompt(null)
  record(replyId)
  finish(replyId)

  return replyId
}

/** Stopped before Claude saved it. */
function stopUnrecorded(replyId: string) {
  fromHost(replyId, {type: 'RUN_FINISHED', status: 'stopped'})
}

function fail(replyId: string) {
  fromHost(replyId, {
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
  })
}

function saved(replyId: string) {
  const reply = turns.list(treeId).replies.find(one => one.id === replyId)

  if (!reply) throw new Error('The Reply was not saved')

  return reply
}

function sessionsStarted() {
  return hostCommands.flatMap(command =>
    command.type === 'reply.start' ? [command.request.session] : []
  )
}

describe('sending the root Prompt', () => {
  it('saves the Prompt and a streaming Reply, and asks the host for it', () => {
    const sent = turns.sendPrompt({treeId, parentReplyId: null, text: 'Hello'})

    if (!sent) throw new Error('Nothing was sent')

    expect(sent.prompt).toMatchObject({treeId, parentReplyId: null})
    expect(sent.reply).toMatchObject({
      promptId: sent.prompt.id,
      provider: 'claude',
      model: 'fake',
      status: 'streaming',
      content: [],
    })
    expect(hostCommands).toEqual([
      {
        type: 'reply.start',
        request: {
          treeId,
          replyId: sent.reply.id,
          model: 'fake',
          systemPrompt: '',
          prompt: {text: 'Hello'},
          vendorProgram,
          session: null,
        },
      },
    ])
    expect(turns.list(treeId)).toEqual({
      prompts: [sent.prompt],
      replies: [sent.reply],
    })
  })

  it('is refused when no Provider is ready, and nothing is saved', () => {
    hostReady = false

    expect(() =>
      turns.sendPrompt({treeId, parentReplyId: null, text: 'Hi'})
    ).toThrow('Connect a Provider to send a Prompt.')
    expect(turns.list(treeId)).toEqual({prompts: [], replies: []})
  })

  it('fails the Reply when the host can’t be reached', () => {
    hostReachable = false

    const sent = turns.sendPrompt({treeId, parentReplyId: null, text: 'Hi'})

    expect(sent?.reply).toMatchObject({
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
    expect(saved(sent?.reply.id ?? '').status).toBe('failed')
    expect(published.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
    expect(turns.streaming()).toEqual([])
  })

  it('is refused once the Tree has one', () => {
    sendPrompt(null)

    expect(() =>
      turns.sendPrompt({treeId, parentReplyId: null, text: 'Again'})
    ).toThrow('This Tree already has its first Prompt.')
    expect(hostCommands).toEqual([])
  })
})

describe('a streaming Reply', () => {
  let replyId: string

  beforeEach(() => {
    replyId = sendPrompt(null)
  })

  it('saves partial text about every second, not on every word', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Hello '})
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'there'})

    expect(saved(replyId).content).toEqual([])

    vi.advanceTimersByTime(PARTIAL_SAVE_MS)

    expect(saved(replyId).content).toEqual([
      {type: 'text', text: 'Hello there'},
    ])
  })

  it('saves each part as soon as it finishes', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Looking.'})
    fromHost(replyId, {
      type: 'TOOL_CALL_START',
      toolCallId: 't1',
      toolName: 'search',
    })

    expect(saved(replyId).content).toEqual([
      {type: 'text', text: 'Looking.'},
      {
        type: 'tool-call',
        toolCallId: 't1',
        toolName: 'search',
        args: '',
        result: null,
      },
    ])

    fromHost(replyId, {
      type: 'TOOL_RESULT',
      toolCallId: 't1',
      content: 'ok',
      isError: false,
    })

    expect(saved(replyId).content[1]).toMatchObject({
      result: {content: 'ok', isError: false},
    })
  })

  it('saves the end as complete with the Context size and the Context window', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Done.'})
    fromHost(replyId, {
      type: 'TOKENS',
      inputTokens: 3,
      outputTokens: 2,
      contextSize: 5,
    })
    fromHost(replyId, {
      type: 'RUN_FINISHED',
      status: 'complete',
      contextWindow: 200_000,
    })

    expect(saved(replyId)).toMatchObject({
      status: 'complete',
      content: [{type: 'text', text: 'Done.'}],
      contextSize: 5,
      contextWindow: 200_000,
    })
    expect(turns.streaming()).toEqual([])
  })

  it('saves why it failed, and lists it with the Reply', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half'})
    fromHost(replyId, {
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'connection-lost', message: 'Connection lost.'},
    })

    expect(saved(replyId)).toMatchObject({
      status: 'failed',
      content: [{type: 'text', text: 'Half'}],
      failure: {code: 'connection-lost', message: 'Connection lost.'},
    })
  })

  it('publishes each event after saving what it needed to', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Hi'})
    finish(replyId)

    expect(published.map(event => event.type)).toEqual([
      'TEXT_DELTA',
      'RUN_FINISHED',
    ])
  })

  it('keeps what it shows for a window that connects mid-stream', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half a '})
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'sentence'})

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

  it('drops events from a host that is not writing it', () => {
    turns.hostEvent('chatgpt', {
      type: 'TEXT_DELTA',
      treeId,
      replyId,
      delta: 'x',
    })

    expect(published).toEqual([])
    expect(turns.streaming()[0]?.content).toEqual([])
  })

  it('saves the Model its Provider reports', () => {
    record(replyId)

    expect(saved(replyId).model).toBe('claude-haiku-5-5')
  })
})

describe('a host crash and quitting', () => {
  it('fails a crashed host’s Replies with the text they last showed', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Cut off mid'})

    turns.hostCrashed('claude')

    expect(saved(replyId)).toMatchObject({
      status: 'failed',
      content: [{type: 'text', text: 'Cut off mid'}],
    })
    expect(published.at(-1)).toEqual({
      type: 'RUN_FINISHED',
      treeId,
      replyId,
      status: 'failed',
      failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
    })
    expect(turns.streaming()).toEqual([])
  })

  it('leaves another Provider’s Replies streaming', () => {
    const replyId = sendPrompt(null)

    turns.hostCrashed('chatgpt')

    expect(saved(replyId).status).toBe('streaming')
  })

  it('saves partial text at once when the app quits, leaving no timer', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half a'})

    turns.quitting()

    expect(saved(replyId)).toMatchObject({
      status: 'streaming',
      content: [{type: 'text', text: 'Half a'}],
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('marks a Reply the last run left streaming as interrupted at launch, continued in a new session', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half a'})
    turns.quitting()

    turns = launch()

    expect(saved(replyId)).toMatchObject({
      status: 'interrupted',
      content: [{type: 'text', text: 'Half a'}],
      failure: null,
    })

    turns.sendPrompt({treeId, parentReplyId: replyId, text: 'Go on'})

    expect(sessionsStarted()).toEqual([null])
  })
})

describe('a Prompt answering a Reply', () => {
  it('continues the Reply’s Provider session from that Reply', () => {
    const replyId = savedRoot()

    const sent = turns.sendPrompt({
      treeId,
      parentReplyId: replyId,
      text: 'And then?',
    })

    expect(sent?.prompt).toMatchObject({parentReplyId: replyId})
    expect(hostCommands).toEqual([
      {
        type: 'reply.start',
        request: {
          treeId,
          replyId: sent?.reply.id,
          model: 'fake',
          systemPrompt: '',
          prompt: {text: 'And then?'},
          vendorProgram,
          session: {
            sessionId: 's1',
            messageId: 'm1',
            fork: false,
            rewind: false,
          },
        },
      },
    ])
  })

  it.each([
    [
      'still streaming',
      (replyId: string) => record(replyId),
      'Wait for this Reply to finish before continuing.',
    ],
    [
      'never saved by its Provider',
      (replyId: string) => finish(replyId),
      'This Reply can’t be continued: its Provider never saved it.',
    ],
  ])('is refused from a Reply %s', (_case, setUp, message) => {
    const replyId = sendPrompt(null)
    setUp(replyId)

    expect(() =>
      turns.sendPrompt({treeId, parentReplyId: replyId, text: 'More'})
    ).toThrow(message)
    expect(hostCommands).toEqual([])
  })

  it('starts a Branch from a Reply that already has a Prompt after it, forking its session', () => {
    const replyId = savedRoot()

    turns.sendPrompt({treeId, parentReplyId: replyId, text: 'More'})
    turns.sendPrompt({treeId, parentReplyId: replyId, text: 'Or instead?'})

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: false, rewind: false},
      {sessionId: 's1', messageId: 'm1', fork: true, rewind: false},
    ])
  })

  it('streams a Branch while the other Branch’s Reply is still being written', () => {
    const replyId = savedRoot()

    const one = sendPrompt(replyId, 'More')
    const two = sendPrompt(replyId, 'Or instead?')

    expect(
      turns
        .streaming()
        .map(streaming => streaming.replyId)
        .toSorted()
    ).toEqual([one, two].toSorted())
  })

  it('answers nothing for a Reply the Tree doesn’t have', () => {
    savedRoot()

    expect(
      turns.sendPrompt({
        treeId,
        parentReplyId: crypto.randomUUID(),
        text: 'More',
      })
    ).toBeNull()
  })

  it('is refused when the Reply’s Provider isn’t ready', () => {
    const replyId = savedRoot()
    hostReady = false

    expect(() =>
      turns.sendPrompt({treeId, parentReplyId: replyId, text: 'More'})
    ).toThrow('Connect Claude to continue this Thread.')
  })
})

describe('continuing from a Reply its Provider never saved', () => {
  it('goes on from the Reply before it when it was stopped, Prompt and all', () => {
    const replyId = savedRoot()
    const cutShort = sendPrompt(replyId, 'And then?')
    stopUnrecorded(cutShort)

    turns.sendPrompt({treeId, parentReplyId: cutShort, text: 'Go on'})

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: false, rewind: false},
    ])
  })

  it('forks the session before it for a second Prompt into the stopped Reply', () => {
    const replyId = savedRoot()
    const cutShort = sendPrompt(replyId, 'And then?')
    stopUnrecorded(cutShort)

    turns.sendPrompt({treeId, parentReplyId: cutShort, text: 'Go on'})
    turns.sendPrompt({treeId, parentReplyId: cutShort, text: 'Or instead?'})

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: false, rewind: false},
      {sessionId: 's1', messageId: 'm1', fork: true, rewind: false},
    ])
  })

  it('starts a new session when the stopped Reply answered the root Prompt', () => {
    const replyId = sendPrompt(null)
    stopUnrecorded(replyId)

    turns.sendPrompt({treeId, parentReplyId: replyId, text: 'On'})

    expect(sessionsStarted()).toEqual([null])
  })
})

describe('stopping a Reply', () => {
  it('asks the host writing it to interrupt it', () => {
    const replyId = sendPrompt(null)

    turns.stop(treeId, replyId)

    expect(hostCommands).toEqual([{type: 'reply.stop', replyId}])
  })

  it.each([
    ['that finished', (replyId: string) => finish(replyId)],
    ['in another Tree', () => (treeId = crypto.randomUUID())],
  ])('is refused for a Reply %s', (_case, setUp) => {
    const replyId = sendPrompt(null)
    setUp(replyId)

    expect(() => turns.stop(treeId, replyId)).toThrow(
      'That Reply isn’t being written.'
    )
    expect(hostCommands).toEqual([])
  })
})

describe('retrying a Reply', () => {
  it('runs the root Prompt again in place, from nothing, in a new session', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'H'})
    fromHost(replyId, {
      type: 'TOKENS',
      inputTokens: 3,
      outputTokens: 2,
      contextSize: 5,
    })
    fail(replyId)

    const reply = turns.retry(treeId, replyId)

    expect(reply).toMatchObject({
      id: replyId,
      status: 'streaming',
      content: [],
      contextSize: null,
      failure: null,
    })
    expect(saved(replyId)).toEqual(reply)
    expect(hostCommands).toEqual([
      {
        type: 'reply.start',
        request: {
          treeId,
          replyId,
          model: 'fake',
          systemPrompt: '',
          prompt: {text: 'Hi'},
          vendorProgram,
          session: null,
        },
      },
    ])
    expect(turns.streaming()).toMatchObject([{replyId, content: []}])
  })

  it('can be stopped once it streams again', () => {
    const replyId = sendPrompt(null)
    fail(replyId)
    turns.retry(treeId, replyId)
    hostCommands = []

    turns.stop(treeId, replyId)

    expect(hostCommands).toEqual([{type: 'reply.stop', replyId}])
  })

  it('rewinds the Provider session to the Reply the Prompt answers', () => {
    const replyId = savedRoot()
    const failed = sendPrompt(replyId, 'And then?')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: false, rewind: true},
    ])
  })

  it('goes on without rewinding when the Reply answered was stopped before its Provider saved it', () => {
    const replyId = savedRoot()
    const cutShort = sendPrompt(replyId, 'And then?')
    stopUnrecorded(cutShort)
    const failed = sendPrompt(cutShort, 'Go on')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: false, rewind: false},
    ])
  })

  it('cuts the session after the interrupted Reply’s Prompt and before the failed one’s, when both were recorded', () => {
    const replyId = savedRoot()
    const interrupted = sendPrompt(replyId, 'And then?')
    recordPrompt(interrupted, 'p-interrupted')
    turns.quitting()
    turns = launch()
    const failed = sendPrompt(interrupted, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        fork: false,
        rewind: false,
        retryCut: {keepThrough: 'p-interrupted', dropFrom: 'p-failed'},
      },
    ])
  })

  it('leaves out a recorded Prompt that went into another session', () => {
    const replyId = savedRoot()
    const interrupted = sendPrompt(replyId, 'And then?')
    recordPrompt(interrupted, 'p-interrupted', 's-other')
    turns.quitting()
    turns = launch()
    const failed = sendPrompt(interrupted, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        fork: false,
        rewind: false,
        retryCut: {keepThrough: null, dropFrom: 'p-failed'},
      },
    ])
  })

  it('forks again, without rewinding, when the Prompt started a Branch', () => {
    const replyId = savedRoot()
    sendPrompt(replyId, 'A')
    const failed = sendPrompt(replyId, 'B')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', fork: true, rewind: false},
    ])
  })

  it.each([
    ['finished', (replyId: string) => finish(replyId)],
    ['is still streaming', () => undefined],
  ])('is refused for a Reply that %s', (_case, setUp) => {
    const replyId = sendPrompt(null)
    setUp(replyId)

    expect(() => turns.retry(treeId, replyId)).toThrow(
      'Only a Reply that failed can be retried.'
    )
    expect(hostCommands).toEqual([])
  })

  it('answers nothing for a Reply the Tree doesn’t have', () => {
    expect(turns.retry(treeId, crypto.randomUUID())).toBeNull()
  })

  it('is refused, leaving the Reply as it is, when its Provider isn’t ready', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'H'})
    fail(replyId)
    hostReady = false

    expect(() => turns.retry(treeId, replyId)).toThrow(
      'Connect Claude to retry.'
    )
    expect(saved(replyId)).toMatchObject({
      status: 'failed',
      content: [{type: 'text', text: 'H'}],
      failure: {code: 'host-crashed'},
    })
  })

  it('fails the Reply again when the host can’t be reached', () => {
    const replyId = sendPrompt(null)
    fail(replyId)
    hostReachable = false

    expect(turns.retry(treeId, replyId)).toMatchObject({
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
  })
})
