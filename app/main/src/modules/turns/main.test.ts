import type {Database} from '#modules/database/main'
import type {FinishedReply, ReplyHosts} from './main'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {openDatabase, schema} from '#modules/database/main'
import {createSessions} from '#modules/sessions/main'
import {createTrees} from '#modules/trees/main'
import {eq} from 'drizzle-orm'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {PARTIAL_SAVE_MS, createTurns} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const vendorProgram = {program: null, configDir: '/claude'}

const createdAt = new Date('2026-10-19T12:00:00.000Z')

const picked = {provider: 'claude', model: 'fake'} as const

let db: Database
let published: AppEvent[]
let whenPublished: (event: AppEvent) => void
let finished: FinishedReply[]
let hostCommands: HostCommand[]
let sentPromptIds: Map<string, string>
let hostReady: boolean
let clock: Date
let hostReachable: boolean
let turns: ReturnType<typeof createTurns>
let treeId: string

const hosts: ReplyHosts = {
  ready: provider => hostReady && provider === 'claude',
  send: (_provider, command) => {
    if (!hostReachable) throw new Error('The claude host is not running.')

    hostCommands.push(command)

    if (command.type === 'reply.start') {
      const {replyId, prompt} = command.request
      sentPromptIds.set(replyId, prompt.messageId)
    }
  },
}

function launch() {
  return createTurns({
    db,
    publish: event => {
      published.push(event)
      whenPublished(event)
    },
    hosts,
    vendorProgramFor: () => vendorProgram,
    now: () => clock,
    onTurnsChanged: () => undefined,
    onReplyFinished: reply => finished.push(reply),
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  whenPublished = () => undefined
  finished = []
  hostCommands = []
  sentPromptIds = new Map()
  hostReady = true
  clock = createdAt
  hostReachable = true
  turns = launch()
  treeId = createTrees(db).create(createdAt).id
})

afterEach(() => {
  vi.useRealTimers()
})

/** The new Reply's id, with the host's commands and the events so far cleared. */
function sendPrompt(parentReplyId: string | null, text = 'Hi') {
  const sent = turns.sendPrompt({model: picked, treeId, parentReplyId, text})

  if (!sent) throw new Error('The Reply it answers is gone')

  hostCommands = []
  published = []

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

/** Main's copy of the session takes the Prompt, under the id main last sent. */
function storePrompt(replyId: string, sessionId = 's1') {
  const messageId = sentPromptIds.get(replyId)

  if (!messageId) throw new Error('The Prompt was not sent')

  turns.hostSessionAppended('claude', sessionId, [messageId])

  return messageId
}

function finish(replyId: string) {
  fromHost(replyId, {type: 'RUN_FINISHED', status: 'complete'})
}

function savedRoot() {
  const replyId = sendPrompt(null)
  record(replyId)
  finish(replyId)

  return replyId
}

/**
 * A Retry under a saved root stored its Prompt, then the app quit and launched
 * again.
 */
function quitAfterRetryStored() {
  const retried = sendPrompt(savedRoot(), 'And then?')
  recordPrompt(retried, 'p-first-attempt')
  fail(retried)
  turns.retry(treeId, retried)
  const stored = storePrompt(retried)
  turns.quitting()
  turns = launch()

  return {retried, stored}
}

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

/** A root exchange in another Tree, recorded by its Provider and then failed. */
function inAnotherTree() {
  const sent = turns.sendPrompt({
    model: picked,
    treeId: createTrees(db).create(createdAt).id,
    parentReplyId: null,
    text: 'Elsewhere',
  })

  if (!sent) throw new Error('The root Prompt was refused')

  const {treeId: otherTreeId, id: replyId} = sent.reply
  turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId: otherTreeId,
    replyId,
    model: 'claude-haiku-5-5',
    session: {sessionId: 's-other', messageId: 'm-other'},
  })
  turns.hostEvent('claude', {
    type: 'RUN_FINISHED',
    treeId: otherTreeId,
    replyId,
    status: 'failed',
    failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
  })
  hostCommands = []

  return sent
}

describe('sending the root Prompt', () => {
  it('saves the Prompt and a streaming Reply on the picked Model, and asks the host for it', () => {
    const opus = {provider: 'claude', model: 'claude-opus-5'} as const

    const sent = turns.sendPrompt({
      model: opus,
      treeId,
      parentReplyId: null,
      text: 'Hello',
    })

    if (!sent) throw new Error('Nothing was sent')

    expect(sent.prompt).toMatchObject({treeId, parentReplyId: null})
    expect(sent.reply).toMatchObject({
      promptId: sent.prompt.id,
      provider: 'claude',
      model: 'claude-opus-5',
      status: 'streaming',
      content: [],
    })
    expect(hostCommands).toEqual([
      {
        type: 'reply.start',
        request: {
          treeId,
          replyId: sent.reply.id,
          model: 'claude-opus-5',
          systemPrompt: '',
          prompt: {text: 'Hello', messageId: expect.any(String)},
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

  it('starts a new Tree from the Model of the newest Reply in any Tree, and says so when a Prompt is sent', () => {
    expect(turns.lastModel()).toBeNull()

    sendPrompt(null, 'Older')
    clock = new Date(createdAt.getTime() + 1000)
    const opus = {provider: 'claude', model: 'claude-opus-5'} as const

    turns.sendPrompt({
      model: opus,
      treeId: createTrees(db).create(clock).id,
      parentReplyId: null,
      text: 'Hi',
    })

    expect(published).toContainEqual({type: 'LAST_MODEL_CHANGED', model: opus})
    expect(turns.lastModel()).toEqual(opus)
  })

  it('is refused when no Provider is ready, and nothing is saved', () => {
    hostReady = false

    expect(() =>
      turns.sendPrompt({model: picked, treeId, parentReplyId: null, text: 'Hi'})
    ).toThrow('Connect a Provider to send a Prompt.')
    expect(turns.list(treeId)).toEqual({prompts: [], replies: []})
  })

  it('fails the Reply when the host can’t be reached', () => {
    hostReachable = false

    const sent = turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: null,
      text: 'Hi',
    })

    expect(sent?.reply).toMatchObject({
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
    expect(saved(sent?.reply.id ?? '').status).toBe('failed')
    expect(
      published.find(event => event.type === 'RUN_FINISHED')
    ).toMatchObject({
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
    expect(turns.streaming()).toEqual([])
  })

  it('is refused once the Tree has one', () => {
    sendPrompt(null)

    expect(() =>
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: null,
        text: 'Again',
      })
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
    const savedWhenFinished: string[] = []
    whenPublished = event => {
      if (event.type === 'RUN_FINISHED') {
        savedWhenFinished.push(saved(replyId).status)
      }
    }

    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Hi'})
    finish(replyId)

    expect(published.map(event => event.type)).toEqual([
      'TEXT_DELTA',
      'RUN_FINISHED',
    ])
    expect(savedWhenFinished).toEqual(['complete'])
  })

  it('keeps what it shows for a window that connects mid-stream', () => {
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half a '})
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'sentence'})
    compact(replyId, 'b1')

    expect(turns.streaming()).toEqual([
      {
        treeId,
        replyId,
        status: 'streaming',
        content: [{type: 'text', text: 'Half a sentence'}],
        contextSize: null,
        contextWindow: null,
        failure: null,
        compacted: true,
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

  it('drops events that name another Tree', () => {
    turns.hostEvent('claude', {
      type: 'TEXT_DELTA',
      treeId: crypto.randomUUID(),
      replyId,
      delta: 'x',
    })

    expect(published).toEqual([])
    expect(turns.streaming()[0]?.content).toEqual([])
  })

  it('keeps its Model and session when a host that is not writing it says it saved it', () => {
    turns.hostRecorded('chatgpt', {
      type: 'REPLY_RECORDED',
      treeId,
      replyId,
      model: 'gpt-5.5',
      session: {sessionId: 's1', messageId: 'm1'},
    })
    finish(replyId)

    expect(saved(replyId).model).toBe('fake')
    expect(finished).toMatchObject([{replyId, model: 'fake'}])
    expect(() =>
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: replyId,
        text: 'More',
      })
    ).toThrow('This Reply can’t be continued: its Provider never saved it.')
  })

  it('saves the Model its Provider reports', () => {
    record(replyId)

    expect(saved(replyId).model).toBe('claude-haiku-5-5')
  })

  it('tells how it ended, on the Model its Provider reports and why it failed', () => {
    const failure = {
      code: 'needs-app-update',
      message: 'Update the app to use this Model.',
    } as const

    record(replyId)

    fromHost(replyId, {type: 'RUN_FINISHED', status: 'failed', failure})

    expect(finished).toEqual([
      {
        provider: 'claude',
        treeId,
        replyId,
        status: 'failed',
        model: 'claude-haiku-5-5',
        failure,
      },
    ])
  })
})

function compact(replyId: string, boundaryId: string) {
  fromHost(replyId, {
    type: 'CONTEXT_COMPACTED',
    sessionId: 's1',
    boundaryId,
  })
}

function compactionsRecorded() {
  const {provider, sessionId, boundaryId, replyId} = schema.compactions

  return db
    .select({provider, sessionId, boundaryId, replyId})
    .from(schema.compactions)
    .all()
}

describe('a Compaction', () => {
  it('is recorded against the Provider session with Claude’s boundary before it is published, and marks only the Reply it happened in', () => {
    const first = savedRoot()
    const replyId = sendPrompt(first)
    const recordedWhenPublished: number[] = []
    whenPublished = () => {
      recordedWhenPublished.push(compactionsRecorded().length)
    }

    compact(replyId, 'b1')

    expect(compactionsRecorded()).toEqual([
      {provider: 'claude', sessionId: 's1', boundaryId: 'b1', replyId},
    ])
    expect(recordedWhenPublished).toEqual([1])
    expect(published).toMatchObject([{type: 'CONTEXT_COMPACTED', replyId}])
    expect(saved(replyId).compacted).toBe(true)
    expect(saved(first).compacted).toBe(false)
  })

  it('is recorded each time the session compacts during one Reply', () => {
    const replyId = sendPrompt(null)

    compact(replyId, 'b1')
    compact(replyId, 'b2')

    expect(compactionsRecorded()).toEqual([
      {provider: 'claude', sessionId: 's1', boundaryId: 'b1', replyId},
      {provider: 'claude', sessionId: 's1', boundaryId: 'b2', replyId},
    ])
  })

  it('is not recorded from a host that is not writing the Reply, or for another Tree', () => {
    const replyId = sendPrompt(null)

    const event = {
      type: 'CONTEXT_COMPACTED',
      replyId,
      sessionId: 's1',
      boundaryId: 'b1',
    } as const

    turns.hostEvent('chatgpt', {...event, treeId})

    expect(compactionsRecorded()).toEqual([])

    turns.hostEvent('claude', {...event, treeId: crypto.randomUUID()})

    expect(compactionsRecorded()).toEqual([])
    expect(saved(replyId).compacted).toBe(false)
  })

  it('of a Subagent is not recorded, and leaves the Reply unmarked', () => {
    const replyId = sendPrompt(null)

    fromHost(replyId, {
      type: 'CONTEXT_COMPACTED',
      subagentId: 'sub-1',
      sessionId: 's1',
      boundaryId: 'b1',
    })

    expect(compactionsRecorded()).toEqual([])
    expect(saved(replyId).compacted).toBe(false)
    expect(turns.streaming()).toMatchObject([{replyId, compacted: false}])
  })

  it('stops marking a Reply that is retried, and stays recorded against the session', () => {
    const replyId = sendPrompt(null)
    compact(replyId, 'b1')
    fail(replyId)

    const retried = turns.retry(treeId, replyId)

    expect(retried?.compacted).toBe(false)
    expect(saved(replyId).compacted).toBe(false)
    expect(compactionsRecorded()).toEqual([
      {provider: 'claude', sessionId: 's1', boundaryId: 'b1', replyId: null},
    ])
  })

  it('stays recorded against the session when its Reply is deleted', () => {
    const replyId = sendPrompt(savedRoot())
    compact(replyId, 'b1')
    finish(replyId)

    turns.deletePrompt(treeId, saved(replyId).promptId)

    expect(compactionsRecorded()).toEqual([
      {provider: 'claude', sessionId: 's1', boundaryId: 'b1', replyId: null},
    ])
  })
})

function storeEntries(uuids: (string | null)[], sessionId = 's1') {
  createSessions(db, () => undefined).handle('claude', {
    op: 'append',
    key: {projectKey: 'project', sessionId},
    entries: uuids.map(uuid =>
      uuid === null ? {type: 'mode'} : {type: 'entry', uuid}
    ),
  })
}

function compactedThread() {
  const first = savedRoot()
  const second = savedAt(first, 'm2')
  const third = savedAt(second, 'm3', 's1', 'b1')
  storeEntries(['p-m1', 'm1', 'p-m2', 'm2', 'p-m3', 'b1', 'm3'])
  hostCommands = []

  return {first, second, third}
}

const forkedBeforeCompaction = {
  type: 'fork',
  sessionId: 's1',
  messageId: 'm1',
  servedThrough: 'm1',
}

function pendingCut(replyId: string) {
  return db
    .select({dropFrom: schema.replies.sessionDropFrom})
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .get()?.dropFrom
}

describe('a Reply before a Compaction in its Claude session', () => {
  it('starts a Branch in a fork of the session served only through it', () => {
    const {first} = compactedThread()

    sendInstead(first)

    expect(sessionsStarted()).toEqual([forkedBeforeCompaction])
  })

  it('takes the next Prompt after Deleting Turns in such a fork, with no cut, which spends the cut', () => {
    const {first, second} = compactedThread()
    turns.deletePrompt(treeId, promptOf(second))
    hostCommands = []

    const sent = sendInstead(first)

    expect(sessionsStarted()).toEqual([forkedBeforeCompaction])
    expect(pendingCut(first)).toBe('p-m2')

    storePrompt(sent.reply.id, 's2')

    expect(pendingCut(first)).toBeNull()
  })

  it('goes on forking from it once the Turn the fork added is deleted too', () => {
    const {first, second} = compactedThread()
    turns.deletePrompt(treeId, promptOf(second))
    const added = savedAt(first, 'm4', 's2')
    turns.deletePrompt(treeId, promptOf(added))
    hostCommands = []

    sendInstead(first)

    expect(sessionsStarted()).toEqual([forkedBeforeCompaction])
  })

  it('retries a Prompt that failed after it in such a fork, without rewinding, as does a Prompt sent in the failed one’s place', () => {
    const first = savedRoot()
    const failed = sendPrompt(first, 'Far too long')
    const promptId = storePrompt(failed)
    compact(failed, 'b1')
    storeEntries(['m1', promptId, 'b1'])
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([forkedBeforeCompaction])

    fail(failed)
    hostCommands = []
    sendInstead(first)

    expect(sessionsStarted()).toEqual([forkedBeforeCompaction])
  })

  it('forks after a stopped Reply’s own Prompt when its Provider never saved it', () => {
    const first = savedRoot()
    const cutShort = sendPrompt(first, 'And then?')
    recordPrompt(cutShort, 'p-cut-short')
    stopUnrecorded(cutShort)
    const below = savedAt(cutShort, 'm3', 's1', 'b1')
    storeEntries(['m1', 'p-cut-short', 'p-m3', 'b1', 'm3'])
    turns.deletePrompt(treeId, promptOf(below))
    hostCommands = []

    sendInstead(cutShort)

    expect(sessionsStarted()).toEqual([
      {
        type: 'fork',
        sessionId: 's1',
        messageId: 'p-cut-short',
        servedThrough: 'p-cut-short',
      },
    ])
  })
})

describe('a stopped Reply its Provider never saved, whose Turn compacted the session', () => {
  it('takes the next Prompt in a fork served through its own Prompt, which the AI still remembers', () => {
    const first = savedRoot()
    const cutShort = sendPrompt(first, 'And then?')
    recordPrompt(cutShort, 'p-cut-short')
    compact(cutShort, 'b1')
    stopUnrecorded(cutShort)
    storeEntries(['m1', 'p-cut-short', 'b1'])

    sendInstead(cutShort)

    expect(sessionsStarted()).toEqual([
      {
        type: 'fork',
        sessionId: 's1',
        messageId: 'p-cut-short',
        servedThrough: 'p-cut-short',
      },
    ])
  })
})

describe('a Reply after a Compaction in its Claude session', () => {
  it('still rewinds for a Retry, cuts after Deleting Turns and forks the whole session for a Branch', () => {
    const first = savedRoot()
    const second = savedAt(first, 'm2', 's1', 'b1')
    const third = savedAt(second, 'm3')
    const failed = sendPrompt(third, 'And then?')
    const failedPrompt = storePrompt(failed)
    storeEntries(['m1', 'p-m2', 'b1', 'm2', 'p-m3', 'm3', failedPrompt])
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {type: 'rewind', sessionId: 's1', messageId: 'm3'},
    ])

    fail(failed)
    turns.deletePrompt(treeId, promptOf(third))
    hostCommands = []
    sendInstead(second)
    sendInstead(second)

    expect(sessionsStarted()).toEqual([
      {
        type: 'cut',
        sessionId: 's1',
        messageId: 'm2',
        keepThrough: 'm2',
        dropFrom: 'p-m3',
      },
      {type: 'fork', sessionId: 's1', messageId: 'm2'},
    ])
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

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: replyId,
      text: 'Go on',
    })

    expect(sessionsStarted()).toEqual([null])
  })
})

describe('a Prompt answering a Reply', () => {
  it('continues the Reply’s Provider session from that Reply', () => {
    const replyId = savedRoot()

    const sent = turns.sendPrompt({
      model: picked,
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
          prompt: {text: 'And then?', messageId: expect.any(String)},
          vendorProgram,
          session: {
            sessionId: 's1',
            messageId: 'm1',
            type: 'continue',
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
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: replyId,
        text: 'More',
      })
    ).toThrow(message)
    expect(hostCommands).toEqual([])
  })

  it('starts a Branch from a Reply that already has a Prompt after it, forking its session', () => {
    const replyId = savedRoot()

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: replyId,
      text: 'More',
    })
    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: replyId,
      text: 'Or instead?',
    })

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
      {sessionId: 's1', messageId: 'm1', type: 'fork'},
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
    const {reply} = inAnotherTree()

    expect(
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: reply.id,
        text: 'More',
      })
    ).toBeNull()
  })

  it('is refused when the Reply’s Provider isn’t ready', () => {
    const replyId = savedRoot()
    hostReady = false

    expect(() =>
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: replyId,
        text: 'More',
      })
    ).toThrow('Connect Claude to continue this Thread.')
  })

  it('is refused on another Provider’s Model, adding nothing to the Tree', () => {
    const replyId = savedRoot()
    const before = turns.list(treeId)

    expect(() =>
      turns.sendPrompt({
        model: {provider: 'chatgpt', model: 'gpt-5.5'},
        treeId,
        parentReplyId: replyId,
        text: 'More',
      })
    ).toThrow('Pick a Claude Model to continue this Thread.')
    expect(turns.list(treeId)).toEqual(before)
    expect(hostCommands).toEqual([])
  })
})

describe('continuing from a Reply its Provider never saved', () => {
  it('goes on from the Reply before it when it was stopped, Prompt and all', () => {
    const replyId = savedRoot()
    const cutShort = sendPrompt(replyId, 'And then?')
    stopUnrecorded(cutShort)

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: cutShort,
      text: 'Go on',
    })

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
    ])
  })

  it('forks the session before it for a second Prompt into the stopped Reply', () => {
    const replyId = savedRoot()
    const cutShort = sendPrompt(replyId, 'And then?')
    stopUnrecorded(cutShort)

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: cutShort,
      text: 'Go on',
    })
    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: cutShort,
      text: 'Or instead?',
    })

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
      {sessionId: 's1', messageId: 'm1', type: 'fork'},
    ])
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

describe('stopping every Reply in a Tree', () => {
  it('ends each one as stopped at once, saving its text, and asks its host to stop', () => {
    const replyId = sendPrompt(null)
    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Half an answer'})

    turns.stopAll(treeId)

    expect(saved(replyId)).toMatchObject({
      status: 'stopped',
      content: [{type: 'text', text: 'Half an answer'}],
    })
    expect(published.at(-1)).toEqual({
      type: 'RUN_FINISHED',
      treeId,
      replyId,
      status: 'stopped',
    })
    expect(hostCommands).toEqual([{type: 'reply.stop', replyId}])
  })

  it('tells no one they finished, and still tells of a Reply in another Tree', () => {
    const root = savedRoot()
    sendPrompt(root)

    const elsewhere = turns.sendPrompt({
      model: picked,
      treeId: createTrees(db).create(createdAt).id,
      parentReplyId: null,
      text: 'Hi',
    })

    if (!elsewhere) throw new Error('The root Prompt was refused')

    finished = []
    turns.stopAll(treeId)

    turns.hostEvent('claude', {
      type: 'RUN_FINISHED',
      treeId: elsewhere.reply.treeId,
      replyId: elsewhere.reply.id,
      status: 'complete',
    })

    expect(finished.map(reply => reply.replyId)).toEqual([elsewhere.reply.id])
  })

  it('drops what their host sends after', () => {
    const replyId = sendPrompt(null)
    turns.stopAll(treeId)
    const count = published.length

    fromHost(replyId, {type: 'TEXT_DELTA', delta: 'Too late'})
    fromHost(replyId, {type: 'RUN_FINISHED', status: 'stopped'})

    expect(published).toHaveLength(count)
    expect(saved(replyId).content).toEqual([])
  })

  it('ends them when their host can’t be reached', () => {
    const replyId = sendPrompt(null)
    hostReachable = false

    turns.stopAll(treeId)

    expect(saved(replyId).status).toBe('stopped')
  })
})

describe('retrying a Reply', () => {
  it('runs the root Prompt again in place, from nothing, in a new session, as a stream that can be stopped', () => {
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
          prompt: {text: 'Hi', messageId: expect.any(String)},
          vendorProgram,
          session: null,
        },
      },
    ])
    expect(turns.streaming()).toMatchObject([{replyId, content: []}])

    hostCommands = []
    turns.stop(treeId, replyId)

    expect(hostCommands).toEqual([{type: 'reply.stop', replyId}])
  })

  it('forgets where its Provider saved the failed attempt', () => {
    const replyId = sendPrompt(null)
    record(replyId)
    fail(replyId)
    turns.retry(treeId, replyId)
    stopUnrecorded(replyId)
    hostCommands = []

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: replyId,
      text: 'On',
    })

    expect(sessionsStarted()).toEqual([null])
  })

  it('rewinds the Provider session to the Reply the Prompt answers', () => {
    const replyId = savedRoot()
    const failed = sendPrompt(replyId, 'And then?')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'rewind'},
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
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
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
        type: 'cut',
        keepThrough: 'p-interrupted',
        dropFrom: 'p-failed',
      },
    ])
  })

  it('cuts after the Prompt a Retry stored before the app quit, not the one of the attempt before', () => {
    const {retried, stored} = quitAfterRetryStored()
    const failed = sendPrompt(retried, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: stored,
        dropFrom: 'p-failed',
      },
    ])
  })

  it('cuts after the Reply before, when the interrupted Reply’s Prompt never reached the session', () => {
    const replyId = savedRoot()
    const interrupted = sendPrompt(replyId, 'And then?')
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
        type: 'cut',
        keepThrough: 'm1',
        dropFrom: 'p-failed',
      },
    ])
  })

  it('cuts after the Reply before, when the Reply answered forked into a session it left once its sibling was deleted', () => {
    const replyId = savedRoot()
    const sibling = sendPrompt(replyId, 'One way')
    stopUnrecorded(sibling)
    const forked = sendPrompt(replyId, 'Another way')
    recordPrompt(forked, 'p-forked', 's-fork')
    stopUnrecorded(forked)
    turns.deletePrompt(treeId, promptOf(sibling))
    const failed = sendPrompt(forked, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: 'm1',
        dropFrom: 'p-failed',
      },
    ])
  })

  it('still cuts before the failed attempt’s Prompt when the last Retry failed before cutting', () => {
    const replyId = savedRoot()
    const interrupted = sendPrompt(replyId, 'And then?')
    recordPrompt(interrupted, 'p-interrupted')
    turns.quitting()
    turns = launch()
    const failed = sendPrompt(interrupted, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)
    turns.retry(treeId, failed)
    fail(failed)
    hostCommands = []

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: 'p-interrupted',
        dropFrom: 'p-failed',
      },
    ])
  })

  it('cuts only after the interrupted Reply’s Prompt once the Provider dropped the failed attempt’s', () => {
    const replyId = savedRoot()
    const interrupted = sendPrompt(replyId, 'And then?')
    recordPrompt(interrupted, 'p-interrupted')
    turns.quitting()
    turns = launch()
    const failed = sendPrompt(interrupted, 'Go on')
    recordPrompt(failed, 'p-failed')
    fail(failed)
    turns.retry(treeId, failed)
    turns.hostPromptDropped('claude', {
      type: 'PROMPT_DROPPED',
      treeId,
      replyId: failed,
    })
    fail(failed)
    hostCommands = []

    turns.retry(treeId, failed)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: 'p-interrupted',
        dropFrom: null,
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
      {sessionId: 's1', messageId: 'm1', type: 'fork'},
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
    const {reply} = inAnotherTree()

    expect(turns.retry(treeId, reply.id)).toBeNull()
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

/** `boundaryId` has the session compact inside the Reply. */
function savedAt(
  parentReplyId: string,
  messageId: string,
  sessionId = 's1',
  boundaryId?: string
) {
  const replyId = sendPrompt(parentReplyId, `Prompt ${messageId}`)
  recordPrompt(replyId, `p-${messageId}`, sessionId)

  if (boundaryId !== undefined) compact(replyId, boundaryId)

  turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'claude-haiku-5-5',
    session: {sessionId, messageId},
  })
  finish(replyId)

  return replyId
}

function promptOf(replyId: string) {
  return saved(replyId).promptId
}

function cutsAsked() {
  return hostCommands.filter(command => command.type === 'session.cut')
}

const cutAtFirst = {
  sessionId: 's1',
  messageId: 'm1',
  type: 'cut',
  keepThrough: 'm1',
  dropFrom: 'p-m2',
}

function deletedMidThread() {
  const first = savedRoot()
  const second = savedAt(first, 'm2')
  savedAt(second, 'm3')
  hostCommands = []
  turns.deletePrompt(treeId, promptOf(second))

  return first
}

describe('deleting a Prompt', () => {
  it('deletes it and every Turn below it, Branches too, and nothing else', () => {
    const first = savedRoot()
    const second = savedAt(first, 'm2')
    const third = savedAt(second, 'm3')
    const branch = savedAt(second, 'm-b', 's-b')
    const below = [second, third, branch]
    const promptIds = below.map(promptOf).toSorted()

    const deleted = turns.deletePrompt(treeId, promptOf(second))

    expect(deleted?.promptIds.toSorted()).toEqual(promptIds)
    expect(deleted?.replyIds.toSorted()).toEqual(below.toSorted())
    expect(turns.list(treeId)).toMatchObject({
      prompts: [{id: promptOf(first)}],
      replies: [{id: first}],
    })
  })

  it('deletes the root Prompt, after which the Tree takes a new one', () => {
    const first = savedRoot()
    const rootPromptId = promptOf(first)

    expect(turns.deletePrompt(treeId, rootPromptId)).toEqual({
      promptIds: [rootPromptId],
      replyIds: [first],
    })
    expect(turns.list(treeId)).toEqual({prompts: [], replies: []})
    expect(
      turns.sendPrompt({
        model: picked,
        treeId,
        parentReplyId: null,
        text: 'Anew',
      })
    ).not.toBeNull()
  })

  it('answers nothing for a Prompt the Tree doesn’t have', () => {
    const {prompt} = inAnotherTree()

    expect(turns.deletePrompt(treeId, prompt.id)).toBeNull()
  })

  it('is refused while a Reply below it streams, deleting nothing', () => {
    const first = savedRoot()
    const second = savedAt(first, 'm2')
    const streaming = sendPrompt(second)

    expect(() => turns.deletePrompt(treeId, promptOf(second))).toThrow(
      'Wait for the Replies below to finish, or stop them, before deleting.'
    )
    expect(
      turns
        .list(treeId)
        .replies.map(reply => reply.id)
        .toSorted()
    ).toEqual([first, second, streaming].toSorted())
  })

  it('asks the host to cut the Provider session back to the Reply it answers', () => {
    const first = deletedMidThread()

    expect(cutsAsked()).toEqual([
      {
        type: 'session.cut',
        treeId,
        replyId: first,
        session: cutAtFirst,
        vendorProgram,
      },
    ])
  })

  it('cuts the session with the next Prompt from that Reply while the host hasn’t', () => {
    const first = deletedMidThread()
    hostCommands = []

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(sessionsStarted()).toEqual([cutAtFirst])
  })

  it('continues from that Reply once the host has cut', () => {
    const first = deletedMidThread()
    turns.hostSessionCut('claude', {
      type: 'SESSION_CUT',
      treeId,
      replyId: first,
      dropFrom: 'p-m2',
    })
    hostCommands = []

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
    ])
  })

  it('still cuts with the next Prompt when the host couldn’t be reached', () => {
    const first = savedRoot()
    const second = savedAt(first, 'm2')
    hostReachable = false
    turns.deletePrompt(treeId, promptOf(second))
    hostReachable = true

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(sessionsStarted()).toEqual([cutAtFirst])
  })

  it('asks for no cut while the host isn’t ready, and cuts with the next Prompt', () => {
    const first = savedRoot()
    const second = savedAt(first, 'm2')
    hostReady = false

    turns.deletePrompt(treeId, promptOf(second))

    expect(cutsAsked()).toEqual([])

    hostReady = true
    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(sessionsStarted()).toEqual([cutAtFirst])
  })

  it('keeps cutting after a Branch’s Prompt went into a forked session', () => {
    const first = deletedMidThread()
    const unsent = sendPrompt(first, 'Again')
    const branch = sendPrompt(first, 'Or instead?')
    fail(unsent)
    recordPrompt(branch, 'p-branch', 's-fork')
    finish(branch)
    turns.deletePrompt(treeId, promptOf(branch))

    turns.retry(treeId, unsent)

    expect(sessionsStarted()).toEqual([cutAtFirst])
  })

  it('stops cutting once the next Reply’s Prompt is in the session', () => {
    const first = deletedMidThread()
    const next = sendPrompt(first, 'Again')
    recordPrompt(next, 'p-next')
    fail(next)

    turns.retry(treeId, next)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'rewind'},
    ])
  })

  it('stops cutting once the Provider dropped the deleted Turns for the next Reply', () => {
    const first = deletedMidThread()
    const next = sendPrompt(first, 'Again')
    turns.hostPromptDropped('claude', {
      type: 'PROMPT_DROPPED',
      treeId,
      replyId: next,
    })
    fail(next)

    turns.retry(treeId, next)

    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'rewind'},
    ])
  })

  it('still cuts on a Retry whose Prompt never reached the session', () => {
    const first = deletedMidThread()
    const next = sendPrompt(first, 'Again')
    fail(next)

    turns.retry(treeId, next)

    expect(sessionsStarted()).toEqual([cutAtFirst])
  })

  it('keeps cutting after the host cut a drop the Tree has since moved past', () => {
    const first = deletedMidThread()
    const next = savedAt(first, 'm-next')
    turns.deletePrompt(treeId, promptOf(next))
    turns.hostSessionCut('claude', {
      type: 'SESSION_CUT',
      treeId,
      replyId: first,
      dropFrom: 'p-m2',
    })
    hostCommands = []

    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(sessionsStarted()).toEqual([{...cutAtFirst, dropFrom: 'p-m-next'}])
  })

  it('asks for no cut when the deleted Prompt started a Branch in a session of its own', () => {
    const first = savedRoot()
    savedAt(first, 'm2')
    const branch = savedAt(first, 'm-b', 's-b')
    hostCommands = []

    turns.deletePrompt(treeId, promptOf(branch))

    expect(cutsAsked()).toEqual([])
  })

  it('asks for no cut when the deleted Reply never reached the session', () => {
    const first = savedRoot()
    const second = sendPrompt(first)
    fail(second)

    turns.deletePrompt(treeId, promptOf(second))
    turns.sendPrompt({
      model: picked,
      treeId,
      parentReplyId: first,
      text: 'Again',
    })

    expect(cutsAsked()).toEqual([])
    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'continue'},
    ])
  })

  it('cuts from the first Prompt below that went on in the session, when the deleted one’s never reached it', () => {
    const first = savedRoot()
    const stopped = sendPrompt(first, 'And then?')
    stopUnrecorded(stopped)
    savedAt(stopped, 'm-below')
    hostCommands = []

    turns.deletePrompt(treeId, promptOf(stopped))

    expect(cutsAsked()).toMatchObject([
      {replyId: first, session: {...cutAtFirst, dropFrom: 'p-m-below'}},
    ])
  })

  it('cuts after a stopped Reply’s own Prompt when its Provider never saved it', () => {
    const first = savedRoot()
    const stopped = sendPrompt(first, 'And then?')
    recordPrompt(stopped, 'p-stopped')
    stopUnrecorded(stopped)
    const below = sendPrompt(stopped, 'Go on')
    recordPrompt(below, 'p-below')
    finish(below)

    turns.deletePrompt(treeId, promptOf(below))

    expect(cutsAsked()).toMatchObject([
      {
        replyId: stopped,
        session: {
          sessionId: 's1',
          messageId: 'm1',
          keepThrough: 'p-stopped',
          dropFrom: 'p-below',
        },
      },
    ])
  })

  it('cuts after the Prompt a Retry stored before the app quit, when the Turns below it are deleted', () => {
    const {retried, stored} = quitAfterRetryStored()
    const below = sendPrompt(retried, 'Go on')
    recordPrompt(below, 'p-below')
    finish(below)

    turns.deletePrompt(treeId, promptOf(below))

    expect(cutsAsked()).toMatchObject([
      {
        replyId: retried,
        session: {
          sessionId: 's1',
          messageId: 'm1',
          keepThrough: stored,
          dropFrom: 'p-below',
        },
      },
    ])
  })
})

/** An exchange its Provider saved, Prompt and Reply, before it failed. */
function failedAt(parentReplyId: string | null, sessionId = 's1') {
  const replyId = sendPrompt(parentReplyId, 'Failing')
  recordPrompt(replyId, 'p-failed', sessionId)
  turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'claude-haiku-5-5',
    session: {sessionId, messageId: 'm-failed'},
  })
  fail(replyId)
  hostCommands = []

  return {replyId, promptId: promptOf(replyId)}
}

/** Sorted, since Turns sent in the same millisecond list in any order. */
function savedReplyIds() {
  return turns
    .list(treeId)
    .replies.map(reply => reply.id)
    .toSorted()
}

function sendInstead(parentReplyId: string | null) {
  const sent = turns.sendPrompt({
    model: picked,
    treeId,
    parentReplyId,
    text: 'Instead',
  })

  if (!sent) throw new Error('The Reply it answers is gone')

  return sent
}

describe('sending a Prompt where one failed', () => {
  it('takes the failed Prompt’s place, rewinding the session as a Retry would so the Reply above doesn’t fork', () => {
    const first = savedRoot()
    const failed = failedAt(first)

    const sent = sendInstead(first)

    expect(sent.removed).toEqual({
      promptIds: [failed.promptId],
      replyIds: [failed.replyId],
    })
    expect(savedReplyIds()).toEqual([first, sent.reply.id].toSorted())
    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'rewind'},
    ])
  })

  it('cuts after the Prompt a Retry stored before the app quit, as a Retry of the failed one would', () => {
    const {retried, stored} = quitAfterRetryStored()
    failedAt(retried)

    sendInstead(retried)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: stored,
        dropFrom: 'p-failed',
      },
    ])
  })

  it('cuts after the Reply before, when the interrupted Reply above never reached the session', () => {
    const first = savedRoot()
    const interrupted = sendPrompt(first, 'And then?')
    turns.quitting()
    turns = launch()
    failedAt(interrupted)

    sendInstead(interrupted)

    expect(sessionsStarted()).toEqual([
      {
        sessionId: 's1',
        messageId: 'm1',
        type: 'cut',
        keepThrough: 'm1',
        dropFrom: 'p-failed',
      },
    ])
  })

  it('makes the new Prompt the root in place of a failed one, in a new session, keeping the Tree and its settings', () => {
    const trees = createTrees(db)
    trees.rename(treeId, 'Lisbon')
    const failed = failedAt(null)

    const sent = sendInstead(null)

    expect(sent.removed).toEqual({
      promptIds: [failed.promptId],
      replyIds: [failed.replyId],
    })
    expect(turns.list(treeId)).toEqual({
      prompts: [sent.prompt],
      replies: [sent.reply],
    })
    expect(sessionsStarted()).toEqual([null])
    expect(trees.list()).toMatchObject([
      {id: treeId, title: 'Lisbon', firstLine: 'Instead'},
    ])
  })

  it('forks the session as a Retry would when the Reply above has a Branch too', () => {
    const first = savedRoot()
    const branch = savedAt(first, 'm-b')
    const failed = failedAt(first, 's-fork')

    const sent = sendInstead(first)

    expect(sent.removed).toEqual({
      promptIds: [failed.promptId],
      replyIds: [failed.replyId],
    })
    expect(savedReplyIds()).toEqual([first, branch, sent.reply.id].toSorted())
    expect(sessionsStarted()).toEqual([
      {sessionId: 's1', messageId: 'm1', type: 'fork'},
    ])
  })

  it('removes nothing where no Prompt failed, with failed ones elsewhere', () => {
    const elsewhere = inAnotherTree()
    const first = savedRoot()
    const done = savedAt(first, 'm2')
    const failedBelow = failedAt(done)

    const sent = sendInstead(first)

    expect(sent.removed).toEqual({promptIds: [], replyIds: []})
    expect(savedReplyIds()).toEqual(
      [first, done, failedBelow.replyId, sent.reply.id].toSorted()
    )
    expect(turns.list(elsewhere.prompt.treeId).prompts).toEqual([
      elsewhere.prompt,
    ])
  })

  it('still drops the failed attempt when the new Prompt fails before reaching the session', () => {
    const first = savedRoot()
    const interrupted = sendPrompt(first, 'And then?')
    recordPrompt(interrupted, 'p-interrupted')
    turns.quitting()
    turns = launch()
    failedAt(interrupted)
    const next = sendInstead(interrupted).reply.id
    fail(next)

    turns.retry(treeId, next)

    const cut = {
      sessionId: 's1',
      messageId: 'm1',
      type: 'cut',
      keepThrough: 'p-interrupted',
      dropFrom: 'p-failed',
    }

    expect(sessionsStarted()).toEqual([cut, cut])
  })
})
