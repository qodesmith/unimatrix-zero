import type {HostProcess, HostStatus} from './main'
import type {
  HostCommand,
  OneShotFinished,
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
  SessionCutReport,
  SessionStoreRequest,
} from '@uz/contract/host'
import type {Model, ProviderId, SignInUpdate} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {
  ONE_SHOT_TIMEOUT_MS,
  RESTART_DELAYS_MS,
  STABLE_AFTER_MS,
  createProviderHosts,
} from './main'

const hostReady = {type: 'HOST_READY', smallestModel: 'fake-small'}

const vendorProgram = {program: null, configDir: '/claude'}

const textDelta = {
  type: 'TEXT_DELTA',
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  delta: 'Hi',
} as const

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
let promptsRecorded: PromptRecorded[]
let promptsDropped: PromptDropped[]
let sessionsCut: SessionCutReport[]
let storeRequests: SessionStoreRequest[]
let signInUpdates: SignInUpdate[]
let statuses: HostStatus[]
let crashes: ProviderId[]
let modelLists: {provider: ProviderId; models: Model[]}[]

function setUp() {
  return createProviderHosts({
    spawn: () => {
      const child = fakeProcess()
      spawned.push(child)

      return child.process
    },
    onReplyEvent: (_provider, event) => events.push(event),
    onPromptRecorded: (_provider, message) => promptsRecorded.push(message),
    onPromptDropped: (_provider, message) => promptsDropped.push(message),
    onSessionCut: (_provider, message) => sessionsCut.push(message),
    onReplyRecorded: (_provider, message) => recorded.push(message),
    onSignInUpdate: (_provider, update) => signInUpdates.push(update),
    onSessionStore: (_provider, request) => {
      storeRequests.push(request)

      if (request.op === 'load') throw new Error('The disk is full.')

      return null
    },
    onStatus: (_provider, status) => statuses.push(status),
    onCrash: provider => crashes.push(provider),
    onModels: (provider, models) => modelLists.push({provider, models}),
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
  promptsRecorded = []
  promptsDropped = []
  sessionsCut = []
  storeRequests = []
  signInUpdates = []
  statuses = []
  crashes = []
  modelLists = []
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

it('is ready once the host says so', () => {
  const hosts = setUp()
  hosts.connect('claude')

  expect(hosts.ready('claude')).toBe(false)

  latest().say(hostReady)

  expect(hosts.ready('claude')).toBe(true)
})

it('passes on the Models a host lists', () => {
  const hosts = setUp()
  hosts.connect('claude')

  const models = [
    {
      id: 'opus',
      name: 'Opus',
      isDefault: true,
      resolvesTo: null,
      needsAppUpdate: false,
    },
  ]

  latest().say({type: 'MODELS_CHANGED', models})

  expect(modelLists).toEqual([{provider: 'claude', models}])
  expect(events).toEqual([])
})

it('passes on Reply events and drops messages that do not parse', () => {
  const hosts = setUp()
  hosts.connect('claude')

  latest().say(textDelta)
  latest().say({...textDelta, extra: true})
  latest().say({type: 'NOPE'})

  expect(events).toEqual([textDelta])
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

it('passes on where the Provider session holds a Reply’s Prompt', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const {treeId, replyId} = textDelta

  const message = {
    type: 'PROMPT_RECORDED',
    treeId,
    replyId,
    session: {sessionId: 's1', messageId: 'p1'},
  } as const

  latest().say(message)

  expect(promptsRecorded).toEqual([message])
  expect(events).toEqual([])
})

it('passes on that a Retry’s cut dropped a Reply’s recorded Prompt', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const {treeId, replyId} = textDelta
  const message = {type: 'PROMPT_DROPPED', treeId, replyId} as const

  latest().say(message)

  expect(promptsDropped).toEqual([message])
  expect(events).toEqual([])
})

it('passes on that a Provider cut deleted Turns from its session', () => {
  const hosts = setUp()
  hosts.connect('claude')
  const {treeId, replyId} = textDelta

  const message = {
    type: 'SESSION_CUT',
    treeId,
    replyId,
    dropFrom: 'p2',
  } as const

  latest().say(message)

  expect(sessionsCut).toEqual([message])
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
  latest().say(hostReady)

  expect(hosts.ready('claude')).toBe(true)
  expect(hosts.ready('chatgpt')).toBe(false)
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
      prompt: {text: 'Hi', messageId: crypto.randomUUID()},
      vendorProgram: {program: null, configDir: '/claude'},
      session: null,
      compactionSettings: {auto: true, threshold: null},
    },
  } as const

  hosts.send('claude', command)

  expect(latest().received).toEqual([command])
})

it('reports a crash and restarts after 1 s, 5 s, then 30 s, then stays down', () => {
  const hosts = setUp()
  hosts.connect('claude')

  for (const delay of RESTART_DELAYS_MS) {
    latest().say(hostReady)
    latest().crash()
    expect(hosts.ready('claude')).toBe(false)

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
  latest().say(hostReady)
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
  latest().say(hostReady)

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
    onPromptRecorded: () => undefined,
    onPromptDropped: () => undefined,
    onSessionCut: () => undefined,
    onReplyRecorded: () => undefined,
    onSignInUpdate: () => undefined,
    onModels: () => undefined,
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

function readyHost() {
  const hosts = setUp()
  hosts.connect('claude')
  latest().say(hostReady)

  return hosts
}

function asked() {
  const command = latest().received.at(-1)

  if (command?.type !== 'one-shot.run') throw new Error('No one-shot was run')

  return command
}

function finish(requestId: string, outcome: OneShotFinished['outcome']) {
  latest().say({type: 'ONE_SHOT_FINISHED', requestId, outcome})
}

describe('a one-shot', () => {
  it('runs on the host’s smallest Model and answers with the matching result', async () => {
    const hosts = readyHost()

    const first = hosts.runOneShot('claude', {prompt: 'Title?', vendorProgram})
    const firstId = asked().requestId
    const second = hosts.runOneShot('claude', {prompt: 'Again?', vendorProgram})
    const secondId = asked().requestId

    expect(latest().received).toEqual([
      {
        type: 'one-shot.run',
        requestId: firstId,
        request: {model: 'fake-small', prompt: 'Title?', vendorProgram},
      },
      {
        type: 'one-shot.run',
        requestId: secondId,
        request: {model: 'fake-small', prompt: 'Again?', vendorProgram},
      },
    ])
    expect(secondId).not.toBe(firstId)

    finish(secondId, {ok: false, message: 'Rate limited.'})
    finish(firstId, {ok: true, text: 'Trip to Lisbon'})

    await expect(first).resolves.toBe('Trip to Lisbon')
    await expect(second).rejects.toThrow('Rate limited.')
  })

  it.each([
    ['its host is not ready', () => setUp()],
    [
      'its host has no smallest Model',
      () => {
        const hosts = setUp()
        hosts.connect('claude')
        latest().say({...hostReady, smallestModel: null})

        return hosts
      },
    ],
  ])('is refused when %s', async (_case, hostsFor) => {
    const hosts = hostsFor()
    hosts.connect('claude')

    const refused = hosts.runOneShot('claude', {
      prompt: 'Title?',
      vendorProgram,
    })

    expect(spawned.flatMap(child => child.received)).toEqual([])
    await expect(refused).rejects.toThrow('can’t run a one-shot')
  })

  it.each([
    ['its host crashes', () => latest().crash()],
    [
      'its host is stopped',
      (hosts: ReturnType<typeof setUp>) => hosts.stop('claude'),
    ],
  ])('fails when %s first', async (_case, interrupt) => {
    const hosts = readyHost()

    const pending = hosts.runOneShot('claude', {
      prompt: 'Title?',
      vendorProgram,
    })

    const {requestId} = asked()

    const settled = pending.then(
      () => 'resolved',
      () => 'rejected'
    )

    vi.advanceTimersByTime(ONE_SHOT_TIMEOUT_MS - 1)
    interrupt(hosts)
    finish(requestId, {ok: true, text: 'Too late'})
    vi.useRealTimers()

    // Settled already, or only the test's own timer can end the race.
    await expect(
      Promise.race([
        settled,
        new Promise(resolve => {
          setTimeout(() => resolve('pending'), 0)
        }),
      ])
    ).resolves.toBe('rejected')
  })

  it('tells its host to cancel it once it takes too long', async () => {
    const hosts = readyHost()

    const pending = hosts.runOneShot('claude', {
      prompt: 'Title?',
      vendorProgram,
    })

    const {requestId} = asked()
    vi.advanceTimersByTime(ONE_SHOT_TIMEOUT_MS)

    await expect(pending).rejects.toThrow('took too long')
    expect(latest().received.at(-1)).toEqual({
      type: 'one-shot.cancel',
      requestId,
    })
  })
})
