import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {openDatabase} from '#modules/database/main'
import {SIGN_IN_CANCELED, signInFailed} from '@uz/contract/providers'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createConnections} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const request = {program: null, configDir: '/data/providers/claude'}

const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

const account = {email: 'sam@example.com', plan: 'Max'}

let db: Database
let published: AppEvent[]
let sent: {provider: ProviderId; command: HostCommand}[]
let running: Set<ProviderId>
let opened: string[]
let reachable: boolean
let requestable: Set<ProviderId>

function setUp() {
  return createConnections({
    db,
    hosts: {
      connect: provider => running.add(provider),
      send: (provider, command) => {
        if (!reachable) throw new Error('The host is not running.')

        sent.push({provider, command})
      },
      stop: provider => running.delete(provider),
    },
    publish: event => published.push(event),
    requestFor: provider => (requestable.has(provider) ? request : null),
    openExternal: page => opened.push(page),
    now: () => new Date('2026-10-21T12:00:00.000Z'),
  })
}

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  sent = []
  running = new Set()
  opened = []
  reachable = true
  requestable = new Set(['claude'])
})

function connected(connections: ReturnType<typeof setUp>) {
  connections.connect('claude')
  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account,
  })
}

it('starts with every Provider not connected and no Models', () => {
  expect(setUp().snapshot()).toEqual({
    providers: [
      {provider: 'claude', status: 'not-connected', account: null},
      {provider: 'chatgpt', status: 'not-connected', account: null},
    ],
    models: {claude: [], chatgpt: []},
    signIn: null,
  })
})

it('starts the Provider’s host and asks it to connect', () => {
  const connections = setUp()

  connections.connect('claude')

  expect(running).toEqual(new Set(['claude']))
  expect(sent).toEqual([
    {provider: 'claude', command: {type: 'sign-in.start', request}},
  ])
  expect(published).toEqual([
    {type: 'SIGN_IN_STEP', provider: 'claude', step: 'get-ready'},
  ])
})

it('keeps the latest step for a window that connects mid-way', () => {
  const connections = setUp()
  connections.connect('claude')

  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_STEP',
    step: 'sign-in-page',
    url,
  })

  const step = {
    type: 'SIGN_IN_STEP',
    provider: 'claude',
    step: 'sign-in-page',
    url,
  }

  expect(published.at(-1)).toEqual(step)
  expect(connections.snapshot().signIn).toEqual(step)
})

it('connects one Provider at a time', () => {
  const connections = setUp()
  connections.connect('claude')

  expect(() => connections.connect('chatgpt')).toThrow(
    'You can connect ChatGPT once Claude is done.'
  )
})

it('refuses a Provider that can’t be connected here', () => {
  expect(() => setUp().connect('chatgpt')).toThrow('can’t be connected')
  expect(running.size).toBe(0)
})

it('saves the account once connected and reports the Provider’s status', () => {
  const connections = setUp()
  connections.connect('claude')
  connections.applyHostStatus('claude', 'ready')

  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account,
  })

  expect(published.slice(-2)).toEqual([
    {
      type: 'SIGN_IN_FINISHED',
      provider: 'claude',
      outcome: 'connected',
      account,
    },
    {type: 'PROVIDER_STATUS', provider: 'claude', status: 'ready', account},
  ])
  expect(connections.snapshot()).toMatchObject({
    providers: [
      {provider: 'claude', status: 'ready', account},
      {status: 'not-connected'},
    ],
    signIn: null,
  })
  expect(running).toEqual(new Set(['claude']))
})

it('remembers connected Providers and starts their hosts next time', () => {
  connected(setUp())
  running.clear()

  const next = setUp()
  next.startConnected()

  expect(running).toEqual(new Set(['claude']))
  expect(next.snapshot().providers[0]).toEqual({
    provider: 'claude',
    status: 'starting',
    account,
  })
})

it('stops the host again when connecting fails or is canceled', () => {
  for (const outcome of ['failed', 'canceled'] as const) {
    const connections = setUp()
    connections.connect('claude')

    connections.applySignInUpdate(
      'claude',
      outcome === 'failed'
        ? signInFailed('plan-refused', 'No Pro or Max plan.')
        : SIGN_IN_CANCELED
    )

    expect(running.size).toBe(0)
    expect(connections.snapshot().signIn).toBeNull()
    expect(published.at(-1)).toMatchObject({type: 'SIGN_IN_FINISHED', outcome})
  }
})

it('opens the sign-in page itself when the host asks, once', () => {
  const connections = setUp()
  connections.connect('claude')

  const step = {type: 'SIGN_IN_STEP', step: 'sign-in-page', url} as const
  connections.applySignInUpdate('claude', {...step, openPage: true})

  expect(opened).toEqual([url])
  expect(published.at(-1)).toEqual({...step, provider: 'claude'})
  expect(connections.snapshot().signIn).toEqual({...step, provider: 'claude'})
})

it('opens the sign-in page again and tells the host, which then takes a code', () => {
  const connections = setUp()
  connections.connect('claude')
  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_STEP',
    step: 'sign-in-page',
    url,
  })

  connections.openPage('claude')
  connections.submitCode('claude', 'code#s')
  connections.cancel('claude')

  expect(opened).toEqual([url])
  expect(sent.slice(1).map(({command}) => command)).toEqual([
    {type: 'sign-in.page-opened'},
    {type: 'sign-in.code', code: 'code#s'},
    {type: 'sign-in.cancel'},
  ])
})

it('refuses sign-in commands for a Provider that isn’t being connected', () => {
  const connections = setUp()

  expect(() => connections.cancel('claude')).toThrow('isn’t being connected')
  expect(() => connections.submitCode('claude', 'x')).toThrow(
    'isn’t being connected'
  )
  expect(() => connections.openPage('claude')).toThrow('isn’t being connected')
})

it('fails connecting when the host crashes', () => {
  const connections = setUp()
  connections.connect('claude')

  connections.hostCrashed('claude')

  expect(running.size).toBe(0)
  expect(published.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    provider: 'claude',
    outcome: 'failed',
    failure: {reason: 'failed', message: 'Claude stopped unexpectedly.'},
  })
})

it('reports a connected Provider’s host as it restarts', () => {
  const connections = setUp()
  connected(connections)

  connections.applyHostStatus('claude', 'restarting')

  expect(published.at(-1)).toEqual({
    type: 'PROVIDER_STATUS',
    provider: 'claude',
    status: 'restarting',
    account,
  })
})

it('ignores updates from a host that isn’t connecting', () => {
  const connections = setUp()

  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_STEP',
    step: 'check-plan',
  })

  expect(published).toEqual([])
})

const opus = {
  id: 'opus',
  name: 'Opus',
  isDefault: true,
  resolvesTo: 'claude-opus-5',
  needsAppUpdate: false,
}

const sonnet = {
  id: 'sonnet',
  name: 'Sonnet',
  isDefault: false,
  resolvesTo: null,
  needsAppUpdate: false,
}

it('saves a connected Provider’s Models, publishes them and keeps them for next time', () => {
  const connections = setUp()
  connected(connections)

  connections.applyModels('claude', [opus, sonnet])

  expect(published.at(-1)).toEqual({
    type: 'MODELS_CHANGED',
    provider: 'claude',
    models: [opus, sonnet],
  })
  expect(setUp().snapshot().models).toEqual({
    claude: [opus, sonnet],
    chatgpt: [],
  })
})

it('marks the saved Model a Reply was written on as needing an app update, once', () => {
  const connections = setUp()
  connected(connections)
  connections.applyModels('claude', [opus, sonnet])
  const before = published.length
  const gated = [{...opus, needsAppUpdate: true}, sonnet]

  connections.markNeedsAppUpdate('claude', 'claude-opus-5')
  connections.markNeedsAppUpdate('claude', 'opus')
  connections.markNeedsAppUpdate('claude', 'haiku')

  expect(published.slice(before)).toEqual([
    {type: 'MODELS_CHANGED', provider: 'claude', models: gated},
  ])
  expect(setUp().snapshot().models.claude).toEqual(gated)

  connections.markNeedsAppUpdate('claude', 'sonnet')

  expect(setUp().snapshot().models.claude).toEqual([
    gated[0],
    {...sonnet, needsAppUpdate: true},
  ])
})

it('marks every saved Model resolving to the one a Reply was written on', () => {
  const connections = setUp()
  connected(connections)
  const latest = {...sonnet, id: 'default', resolvesTo: 'claude-opus-5'}
  connections.applyModels('claude', [latest, opus])

  connections.markNeedsAppUpdate('claude', 'claude-opus-5')

  expect(setUp().snapshot().models.claude).toEqual([
    {...latest, needsAppUpdate: true},
    {...opus, needsAppUpdate: true},
  ])
})

it('keeps a Model marked as needing an app update when the Provider lists it again', () => {
  const connections = setUp()
  connected(connections)
  connections.applyModels('claude', [opus, sonnet])
  connections.markNeedsAppUpdate('claude', 'opus')

  connections.applyModels('claude', [opus, sonnet])

  expect(published.at(-1)).toEqual({
    type: 'MODELS_CHANGED',
    provider: 'claude',
    models: [{...opus, needsAppUpdate: true}, sonnet],
  })
})

it('asks a connected Provider for its Models once connected and whenever its host is ready', () => {
  const connections = setUp()
  connections.connect('claude')
  connections.applyHostStatus('claude', 'ready')

  const list = {
    provider: 'claude',
    command: {type: 'models.list', vendorProgram: request},
  }

  expect(sent).not.toContainEqual(list)

  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account,
  })
  connections.applyHostStatus('claude', 'restarting')
  connections.applyHostStatus('claude', 'ready')

  expect(sent.slice(1)).toEqual([list, list])
})

it('skips asking for Models when the Provider can’t be connected here or its host can’t be reached', () => {
  const connections = setUp()
  connected(connections)
  sent = []

  requestable.clear()
  connections.applyHostStatus('claude', 'ready')
  requestable.add('claude')
  reachable = false

  expect(() => connections.applyHostStatus('claude', 'ready')).not.toThrow()
  expect(sent).toEqual([])
  expect(published.at(-1)).toMatchObject({
    type: 'PROVIDER_STATUS',
    status: 'ready',
  })
})

it('keeps a Provider’s Models while its host restarts', () => {
  const connections = setUp()
  connected(connections)
  connections.applyModels('claude', [opus])

  connections.applyHostStatus('claude', 'restarting')
  connections.hostCrashed('claude')
  connections.applyHostStatus('claude', 'starting')

  expect(connections.snapshot().models.claude).toEqual([opus])
})
