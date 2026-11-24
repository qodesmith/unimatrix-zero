import type {AppEvent} from '@uz/contract/events'
import type {ProviderId} from '@uz/contract/providers'

import {expect, it} from 'vitest'

import {withFailure} from './cards'
import {connectEach} from './connect-each'
import {
  applyConnectionsEvent,
  createConnectionsStore,
} from './connections-store'

const account = {email: 'sam@example.com', plan: 'Max'}

function setUp() {
  const store = createConnectionsStore()
  const connected: ProviderId[] = []

  function emit(event: AppEvent) {
    applyConnectionsEvent(store, event)
  }

  async function connect(provider: ProviderId) {
    connected.push(provider)
    emit({type: 'SIGN_IN_STEP', provider, step: 'get-ready'})
  }

  return {store, connected, emit, connect}
}

it('connects ChatGPT once Claude’s connect is over, not before', async () => {
  const {store, connected, emit, connect} = setUp()
  const done = connectEach(store, connect)

  await expect.poll(() => connected).toEqual(['claude'])
  emit({type: 'SIGN_IN_STEP', provider: 'claude', step: 'check-plan'})
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  expect(connected).toEqual(['claude'])

  emit({
    type: 'SIGN_IN_FINISHED',
    provider: 'claude',
    outcome: 'connected',
    account,
  })
  await expect.poll(() => connected).toEqual(['claude', 'chatgpt'])

  emit({type: 'SIGN_IN_FINISHED', provider: 'chatgpt', outcome: 'canceled'})
  await done
})

it('skips a Provider that is already connected', async () => {
  const {store, connected, emit, connect} = setUp()
  emit({type: 'PROVIDER_STATUS', provider: 'claude', status: 'ready', account})
  const done = connectEach(store, connect)

  await expect.poll(() => connected).toEqual(['chatgpt'])
  emit({type: 'SIGN_IN_FINISHED', provider: 'chatgpt', outcome: 'canceled'})
  await done
})

it('moves on when main refuses a connect', async () => {
  const {store, connected, emit, connect} = setUp()

  const done = connectEach(store, async provider => {
    if (provider === 'chatgpt') return connect(provider)

    connected.push(provider)
    store.setState(state =>
      withFailure(state, provider, {reason: 'failed', message: 'Refused.'})
    )
  })

  await expect.poll(() => connected).toEqual(['claude', 'chatgpt'])
  emit({type: 'SIGN_IN_FINISHED', provider: 'chatgpt', outcome: 'canceled'})
  await done
})
