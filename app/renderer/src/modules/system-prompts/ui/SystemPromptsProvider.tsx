import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {applyLibraryEvent, createLibraryStore} from '../library-store'
import {LibraryStoreContext} from '../use-library'

export function SystemPromptsProvider({children}: {children: ReactNode}) {
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createLibraryStore)

  useEffect(
    () => bridge().subscribe(event => applyLibraryEvent(store, event)),
    [store]
  )

  return <LibraryStoreContext value={store}>{children}</LibraryStoreContext>
}
