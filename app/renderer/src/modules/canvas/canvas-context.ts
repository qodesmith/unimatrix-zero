import type {Draft, DraftKey} from './drafts'
import type {TreeIndex} from './tree'
import type {Reply} from '@uz/contract/turns'

import {createContext, use} from 'react'

export interface Collapsed {
  ids: ReadonlySet<string>
  toggledReplyId: string | null
}

export interface Expanded {
  ids: ReadonlySet<string>
  toggledTurnId: string | null
}

export interface CanvasState {
  treeId: string
  systemPromptId: string
  index: TreeIndex
  activeReplyId: string | null
  onInputFocus: (replyId: string) => void
  onSent: (replyId: string, parentReplyId: string | null) => void
  inputToFocus: string | null
  onDeleteConfirmed: (promptId: string) => void
  openChat: (replyId: string) => void
  /** Kept here, not in the node, so it survives an orientation switch. */
  expandedTurnIds: ReadonlySet<string>
  toggleExpanded: (turnId: string) => void
  collapsedReplyIds: ReadonlySet<string>
  toggleCollapsed: (replyId: string) => void
  drafts: ReadonlyMap<DraftKey, Draft>
  setDraft: (at: DraftKey, draft: Draft) => void
  limitTurnHeight: boolean
  contextSizeMeter: boolean
}

export const CanvasContext = createContext<CanvasState | null>(null)

export function useCanvas(): CanvasState {
  const state = use(CanvasContext)

  if (!state) throw new Error('Turn nodes render inside <Canvas> only')

  return state
}

/** Null at the root, whose Input on an empty Tree sits outside <Canvas>. */
export function useAttachedReply(parentReplyId: string | null): Reply | null {
  const state = use(CanvasContext)

  if (parentReplyId === null) return null

  return state?.index.replyById.get(parentReplyId) ?? null
}
