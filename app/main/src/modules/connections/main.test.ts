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

function setUp() {
  return createConnections({
    db,
    hosts: {
      connect: provider => running.add(provider),
      send: (provider, command) => sent.push({provider, command}),
      stop: provider => running.delete(provider),
    },
    publish: event => published.push(event),
    requestFor: provider => (provider === 'claude' ? request : null),
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
})

function connected(connections: ReturnType<typeof setUp>) {
  connections.connect('claude')
  connections.applySignInUpdate('claude', {
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account,
  })
}

it('starts with every Provider not connected', () => {
  expect(setUp().snapshot()).toEqual({
    providers: [
      {provider: 'claude', status: 'not-connected', account: null},
      {provider: 'chatgpt', status: 'not-connected', account: null},
    ],
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
