import type {QueryClient} from '@tanstack/react-query'
import type {AppEvent} from '@uz/contract/events'

import {Store} from '@tanstack/react-store'

export interface FileAt {
  treeId: string
  replyId: string
  path: string
}

interface TreeFilesState {
  shown: {treeId: string; replyId: string | null} | null
  previewed: FileAt | null
}

export type TreeFilesStore = Store<TreeFilesState>

export function createTreeFilesStore(): TreeFilesStore {
  return new Store<TreeFilesState>({shown: null, previewed: null})
}

export function treeFilesKey(treeId: string, replyId?: string) {
  return replyId === undefined
    ? ['tree-files', treeId]
    : ['tree-files', treeId, replyId]
}

const CHANGES_SNAPSHOTS: ReadonlySet<AppEvent['type']> = new Set([
  'RUN_STARTED',
  'RUN_FINISHED',
  'FILES_CHANGED',
])

/**
 * A starting or finished Reply changes the Tree's folder or Snapshot, so every
 * list may be stale.
 */
export function refetchAfter(queryClient: QueryClient, event: AppEvent) {
  if (event.type === 'SNAPSHOT') {
    void queryClient.invalidateQueries({queryKey: ['tree-files']})
  } else if (CHANGES_SNAPSHOTS.has(event.type) && 'treeId' in event) {
    void queryClient.invalidateQueries({queryKey: treeFilesKey(event.treeId)})
  }
}
