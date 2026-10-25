import type {ConnectionsState} from './cards'
import type {AppEvent} from '@uz/contract/events'

import {Store} from '@tanstack/react-store'

import {NOT_LOADED, applyConnectionEvent} from './cards'

export type ConnectionsStore = Store<ConnectionsState>

export function createConnectionsStore(): ConnectionsStore {
  return new Store<ConnectionsState>(NOT_LOADED)
}

export function applyConnectionsEvent(
  store: ConnectionsStore,
  event: AppEvent
) {
  store.setState(current => applyConnectionEvent(current, event))
}
