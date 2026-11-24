import type {ConnectionsStore} from './connections-store'
import type {ProviderId} from '@uz/contract/providers'

import {ProviderIdSchema} from '@uz/contract/providers'

import {cardOf} from './cards'

/** Resolves once main has ended this connect, or refused it. */
async function connectOver(store: ConnectionsStore, provider: ProviderId) {
  const stale = store.state.failures[provider]

  return new Promise<void>(resolve => {
    let started = false

    const subscription = store.subscribe(state => {
      const connecting = state.signIn?.provider === provider
      started ||= connecting
      const refused = state.failures[provider] !== stale

      if (connecting || !(started || refused)) return

      subscription.unsubscribe()
      resolve()
    })
  })
}

/**
 * Dev only. Connects each Provider not yet connected, each once the one before
 * is over, whatever its outcome: canceling Claude moves on to ChatGPT.
 */
export async function connectEach(
  store: ConnectionsStore,
  connect: (provider: ProviderId) => Promise<void>
) {
  for (const provider of ProviderIdSchema.options) {
    if (cardOf(store.state, provider).kind === 'connected') continue

    const over = connectOver(store, provider)
    await connect(provider)
    await over
  }
}
