import type {AppEvent} from '@uz/contract/events'
import type {Layout} from '@uz/contract/layout'

import {Store} from '@tanstack/react-store'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'

export type LayoutStore = Store<Layout>

/** The defaults until main's SNAPSHOT says otherwise. */
export function createLayoutStore(): LayoutStore {
  return new Store<Layout>(DEFAULT_LAYOUT)
}

/**
 * Main sends the whole Layout whenever any of it changes, so each event
 * replaces it.
 */
export function applyLayoutEvent(store: LayoutStore, event: AppEvent) {
  if (event.type === 'SNAPSHOT' || event.type === 'LAYOUT_CHANGED') {
    store.setState(() => event.layout)
  }
}
