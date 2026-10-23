import type {AppEvent} from '@uz/contract/events'
import type {Settings} from '@uz/contract/settings'

import {Store} from '@tanstack/react-store'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'

export type SettingsStore = Store<Settings>

/** The defaults until main's SNAPSHOT says otherwise. */
export function createSettingsStore(): SettingsStore {
  return new Store<Settings>(DEFAULT_SETTINGS)
}

/** Main sends every Setting whenever any changes, so each event replaces them. */
export function applySettingsEvent(store: SettingsStore, event: AppEvent) {
  if (event.type === 'SNAPSHOT' || event.type === 'SETTINGS_CHANGED') {
    store.setState(() => event.settings)
  }
}
