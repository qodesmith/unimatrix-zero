import type {HostProcess, HostStatus} from './main'
import type {
  HostCommand,
  ReplyRecorded,
  SessionStoreRequest,
} from '@uz/contract/host'
import type {ProviderId, SignInUpdate} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {RESTART_DELAYS_MS, STABLE_AFTER_MS, createProviderHosts} from './main'

const models = [{id: 'fake', name: 'Fake model'}]

const textDelta = {
  type: 'TEXT_DELTA',
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  delta: 'Hi',
} as const

/** A host process main can drive and the test can make talk or crash. */
function fakeProcess() {
  const received: HostCommand[] = []
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- HostProcess hands main whatever the host sent
  const messageListeners: ((message: unknown) => void)[] = []
  const exitListeners: (() => void)[] = []
  let killed = false

  function crash() {
    for (const listener of exitListeners) listener()
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- tests send malformed messages too
  function say(message: unknown) {
    for (const listener of messageListeners) listener(message)
  }

  const process: HostProcess = {
    post: command => received.push(command),
    onMessage: listener => messageListeners.push(listener),
    onExit: listener => exitListeners.push(listener),
    kill: () => {
      killed = true
      crash()
    },
  }

  return {process, received, say, crash, isKilled: () => killed}
}

let spawned: ReturnType<typeof fakeProcess>[]
let events: ReplyEvent[]
let recorded: ReplyRecorded[]
let storeRequests: SessionStoreRequest[]
let signInUpdates: SignInUpdate[]
let statuses: HostStatus[]
let crashes: ProviderId[]

function setUp() {
  return createProviderHosts({
    spawn: () => {
      const child = fakeProcess()
      spawned.push(child)

      return child.process
    },
    onReplyEvent: (_provider, event) => events.push(event),
    onReplyRecorded: (_provider, message) => recorded.push(message),
    onSignInUpdate: (_provider, update) => signInUpdates.push(update),
    onSessionStore: (_provider, request) => {
      storeRequests.push(request)

      if (request.op === 'load') throw new Error('The disk is full.')

      return null
    },
    onStatus: (_provider, status) => statuses.push(status),
    onCrash: provider => crashes.push(provider),
  })
}

function latest() {
  const child = spawned.at(-1)

  if (!child) throw new Error('No host was started')

  return child
}

beforeEach(() => {
  vi.useFakeTimers()
  spawned = []
  events = []
  recorded = []
  storeRequests = []
  signInUpdates = []
  statuses = []
  crashes = []
})

afterEach(() => {
  vi.useRealTimers()
})

it('starts a host only when its Provider is connected, and only once', () => {
  const hosts = setUp()

  expect(spawned).toHaveLength(0)

  hosts.connect('claude')
  hosts.connect('claude')

  expect(spawned).toHaveLength(1)
})

it('is ready once the host says so, with its first Model', () => {
  const hosts = setUp()
  hosts.connect('claude')

  expect(hosts.ready()).toBeNull()

  latest().say({type: 'HOST_READY', models})

  expect(hosts.ready()).toEqual({provider: 'claude', model: models[0]})
})

it('passes on Reply events and drops messages that do not parse', () => {
  const hosts = setUp()
  hosts.connect('claude')

  latest().say(textDelta)
  latest().say({...textDelta, extra: true})
  latest().say({type: 'NOPE'})

  expect(events).toEqual([textDelta])
})

it('drops a RUN_FINISHED from a Subagent, which would end its whole Reply', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const {treeId, replyId} = textDelta

  latest().say({
    type: 'RUN_FINISHED',
    treeId,
    replyId,
    subagentId: 's1',
    status: 'complete',
  })

  expect(events).toEqual([])
})

it('passes on where the Provider saved a Reply', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const {treeId, replyId} = textDelta

  const message = {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'claude-haiku-5-5',
    session: {sessionId: 's1', messageId: 'm1'},
  } as const

  latest().say(message)

  expect(recorded).toEqual([message])
  expect(events).toEqual([])
})

it('answers a host’s session store requests, failures included', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const key = {projectKey: 'p', sessionId: 's'}
  const append = {op: 'append', key, entries: [{type: 'user'}]} as const

  latest().say({type: 'SESSION_STORE', requestId: 'r1', request: append})
  latest().say({
    type: 'SESSION_STORE',
    requestId: 'r2',
    request: {op: 'load', key},
  })

  expect(storeRequests).toEqual([append, {op: 'load', key}])
  expect(latest().received).toEqual([
    {
      type: 'session-store.result',
      requestId: 'r1',
      outcome: {ok: true, value: null},
    },
    {
      type: 'session-store.result',
      requestId: 'r2',
      outcome: {ok: false, message: 'The disk is full.'},
    },
  ])
})

it('is ready for a given Provider only when that Provider’s host is', () => {
  const hosts = setUp()
  hosts.connect('claude')
  latest().say({type: 'HOST_READY', models})

  expect(hosts.ready('claude')).toEqual({provider: 'claude', model: models[0]})
  expect(hosts.ready('chatgpt')).toBeNull()
})

it('sends commands to the Provider’s host', () => {
  const hosts = setUp()
  hosts.connect('claude')

  const command = {
    type: 'reply.start',
    request: {
      treeId: textDelta.treeId,
      replyId: textDelta.replyId,
      model: 'fake',
      systemPrompt: '',
      prompt: {text: 'Hi'},
      vendorProgram: {program: null, configDir: '/claude'},
      session: null,
    },
  } as const

  hosts.send('claude', command)

  expect(latest().received).toEqual([command])
})

it('reports a crash and restarts after 1 s, 5 s, then 30 s, then stays down', () => {
  const hosts = setUp()
  hosts.connect('claude')

  for (const delay of RESTART_DELAYS_MS) {
    latest().crash()
    expect(hosts.ready()).toBeNull()

    const before = spawned.length
    vi.advanceTimersByTime(delay - 1)
    expect(spawned).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(spawned).toHaveLength(before + 1)
  }

  latest().crash()
  vi.advanceTimersByTime(60 * 60_000)

  expect(spawned).toHaveLength(1 + RESTART_DELAYS_MS.length)
  expect(crashes).toHaveLength(1 + RESTART_DELAYS_MS.length)
})

it('starts the backoff over once a restarted host has stayed up', () => {
  const hosts = setUp()
  hosts.connect('claude')

  latest().crash()
  vi.advanceTimersByTime(RESTART_DELAYS_MS[0] ?? 0)
  latest().say({type: 'HOST_READY', models})
  vi.advanceTimersByTime(STABLE_AFTER_MS)

  latest().crash()
  const before = spawned.length
  vi.advanceTimersByTime(RESTART_DELAYS_MS[0] ?? 0)

  expect(spawned).toHaveLength(before + 1)
})

it('ignores a message from a host it has replaced', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const crashed = latest()

  crashed.crash()
  vi.advanceTimersByTime(RESTART_DELAYS_MS[0] ?? 0)
  crashed.say(textDelta)

  expect(events).toEqual([])
})

it('stops every host without counting it as a crash', () => {
  const hosts = setUp()
  hosts.connect('claude')

  hosts.stopAll()
  vi.advanceTimersByTime(60 * 60_000)

  expect(latest().isKilled()).toBe(true)
  expect(crashes).toEqual([])
  expect(spawned).toHaveLength(1)
})

it('reports where the host stands as it starts, crashes and gives up', () => {
  const hosts = setUp()
  hosts.connect('claude')
  latest().say({type: 'HOST_READY', models})

  for (const delay of RESTART_DELAYS_MS) {
    latest().crash()
    vi.advanceTimersByTime(delay)
  }

  latest().crash()

  expect(statuses).toEqual([
    'starting',
    'ready',
    ...RESTART_DELAYS_MS.flatMap(() => ['restarting', 'starting'] as const),
    'failed',
  ])
})

it('passes on each step of connecting', () => {
  const hosts = setUp()
  hosts.connect('claude')

  const step = {type: 'SIGN_IN_STEP', step: 'check-plan'} as const
  latest().say(step)
  latest().say({type: 'SIGN_IN_FINISHED', outcome: 'canceled'})

  expect(signInUpdates).toEqual([
    step,
    {type: 'SIGN_IN_FINISHED', outcome: 'canceled'},
  ])
  expect(events).toEqual([])
})

it('stops one host without counting it as a crash, and can start it again', () => {
  const hosts = setUp()
  hosts.connect('claude')
  hosts.connect('chatgpt')
  const [claude] = spawned

  hosts.stop('claude')
  vi.advanceTimersByTime(60 * 60_000)

  expect(claude?.isKilled()).toBe(true)
  expect(crashes).toEqual([])
  expect(() => hosts.send('claude', {type: 'sign-in.cancel'})).toThrow(
    'not running'
  )

  hosts.connect('claude')

  expect(spawned).toHaveLength(3)
})

it('does not restart a host that was stopped while its crash was handled', () => {
  let hosts: ReturnType<typeof createProviderHosts> | null = null

  hosts = createProviderHosts({
    spawn: () => {
      const child = fakeProcess()
      spawned.push(child)

      return child.process
    },
    onReplyEvent: () => undefined,
    onReplyRecorded: () => undefined,
    onSignInUpdate: () => undefined,
    onSessionStore: () => null,
    onStatus: (_provider, status) => statuses.push(status),
    onCrash: provider => hosts?.stop(provider),
  })
  hosts.connect('claude')

  latest().crash()
  vi.advanceTimersByTime(60 * 60_000)

  expect(spawned).toHaveLength(1)
  expect(statuses).toEqual(['starting'])
})
