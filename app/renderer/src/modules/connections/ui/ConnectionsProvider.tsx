import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {
  applyConnectionsEvent,
  createConnectionsStore,
} from '../connections-store'
import {ConnectionsStoreContext} from '../use-connections'

/**
 * Keeps the Providers' connections in step with main for everything inside
 * it, on one subscription: each subscription makes main send a `SNAPSHOT`,
 * which every listener in the window takes as a fresh start.
 */
export function ConnectionsProvider({children}: {children: ReactNode}) {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createConnectionsStore)

  useEffect(
    () => bridge().subscribe(event => applyConnectionsEvent(store, event)),
    [store]
  )

  return (
    <ConnectionsStoreContext value={store}>{children}</ConnectionsStoreContext>
  )
}
