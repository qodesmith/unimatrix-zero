import type {ReactNode} from 'react'

import {bridge} from '#modules/bridge/main'
import {useQueryClient} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

import {createTreeFilesStore, refetchAfter} from '../tree-files-store'
import {TreeFilesStoreContext} from '../use-tree-files'

export function TreeFilesProvider({children}: {children: ReactNode}) {
  const queryClient = useQueryClient()
  // oxlint-disable-next-line react/hook-use-state -- created once and never replaced
  const [store] = useState(createTreeFilesStore)

  useEffect(
    () => bridge().subscribe(event => refetchAfter(queryClient, event)),
    [queryClient]
  )

  return <TreeFilesStoreContext value={store}>{children}</TreeFilesStoreContext>
}
