import type {AppEvent} from '@uz/contract/events'
import type {SystemPromptLibrary} from '@uz/contract/system-prompts'

import {Store} from '@tanstack/react-store'
import {PRESETS} from '@uz/contract/system-prompts'

export type LibraryStore = Store<SystemPromptLibrary>

export function createLibraryStore(): LibraryStore {
  return new Store<SystemPromptLibrary>({entries: [...PRESETS]})
}

export function applyLibraryEvent(store: LibraryStore, event: AppEvent) {
  if (event.type === 'SNAPSHOT' || event.type === 'SYSTEM_PROMPTS_CHANGED') {
    store.setState(() => event.systemPrompts)
  }
}
