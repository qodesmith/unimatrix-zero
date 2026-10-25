import type {ConnectionsStore} from './connections-store'
import type {Command} from '@uz/contract/commands'
import type {ProviderId} from '@uz/contract/providers'

import {bridge} from '#modules/bridge/main'
import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

import {withFailure} from './cards'

export const ConnectionsStoreContext = createContext<ConnectionsStore | null>(
  null
)

export function useConnectionsStore() {
  const store = use(ConnectionsStoreContext)

  if (!store) {
    throw new Error('useConnections needs <ConnectionsProvider> above it')
  }

  return store
}

/**
 * Which Providers are connected, and the one being connected, as main reports
 * them. A command main refuses shows on the Provider's card.
 */
export function useConnections() {
  const store = useConnectionsStore()
  const state = useSelector(store, current => current)

  async function run(provider: ProviderId, command: Command) {
    const outcome = await bridge().send(command)

    if (!outcome.ok) {
      store.setState(current =>
        withFailure(current, provider, {
          reason: 'failed',
          message: outcome.error.message,
        })
      )
    }
  }

  return {
    state,
    connect: async (provider: ProviderId) =>
      run(provider, {type: 'provider.connect', provider}),
    openPage: async (provider: ProviderId) =>
      run(provider, {type: 'sign-in.open-page', provider}),
    submitCode: async (provider: ProviderId, code: string) =>
      run(provider, {type: 'sign-in.code', provider, code}),
    cancel: async (provider: ProviderId) =>
      run(provider, {type: 'sign-in.cancel', provider}),
  }
}

export type ConnectionsControls = ReturnType<typeof useConnections>
