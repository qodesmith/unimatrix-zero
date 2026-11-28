import type {FileAt, TreeFilesStore} from './tree-files-store'

import {bridge} from '#modules/bridge/main'
import {keepPreviousData, useQuery} from '@tanstack/react-query'
import {useSelector} from '@tanstack/react-store'
import {createContext, use, useEffect} from 'react'

import {treeFilesKey} from './tree-files-store'

export const TreeFilesStoreContext = createContext<TreeFilesStore | null>(null)

function useTreeFilesStore() {
  const store = use(TreeFilesStoreContext)

  if (!store) throw new Error('Tree files need <TreeFilesProvider> above them')

  return store
}

export function useShowTreeFiles(treeId: string, replyId: string | null) {
  const store = useTreeFilesStore()

  useEffect(() => {
    store.setState(state => ({...state, shown: {treeId, replyId}}))
  }, [store, treeId, replyId])

  useEffect(
    () => () => {
      store.setState(state => ({
        shown: null,
        previewed: state.previewed?.treeId === treeId ? null : state.previewed,
      }))
    },
    [store, treeId]
  )
}

export function useShownTreeFiles() {
  return useSelector(useTreeFilesStore(), state => state.shown)
}

export function usePreviewedFile() {
  return useSelector(useTreeFilesStore(), state => state.previewed)
}

export function useOpenTreeFile() {
  const store = useTreeFilesStore()

  return (file: FileAt) => {
    store.setState(state => ({...state, previewed: file}))
  }
}

export function useCloseTreeFile() {
  const store = useTreeFilesStore()

  return () => {
    store.setState(state => ({...state, previewed: null}))
  }
}

/**
 * `keepLastShown` keeps the last Reply's list until this one's comes, so open
 * folders and scroll hold.
 */
export function useTreeFileList(
  treeId: string,
  replyId: string,
  {keepLastShown = false} = {}
) {
  return useQuery({
    queryKey: treeFilesKey(treeId, replyId),
    placeholderData: keepLastShown ? keepPreviousData : undefined,
    queryFn: async () => {
      const outcome = await bridge().send({
        type: 'tree-files.list',
        treeId,
        replyId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      return outcome.value
    },
  })
}
