import type {LibraryStore} from './library-store'
import type {SystemPromptEntry} from '@uz/contract/system-prompts'

import {useSelector} from '@tanstack/react-store'
import {createContext, use} from 'react'

export const LibraryStoreContext = createContext<LibraryStore | null>(null)

export function useLibrary(): SystemPromptEntry[] {
  const store = use(LibraryStoreContext)

  if (!store)
    throw new Error('useLibrary needs <SystemPromptsProvider> above it')

  return useSelector(store, state => state.entries)
}
