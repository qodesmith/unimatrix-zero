import type {Draft, DraftKey} from './drafts'
import type {TreeIndex} from './tree'
import type {Reply} from '@uz/contract/turns'

import {createContext, use} from 'react'

export interface Collapsed {
  ids: ReadonlySet<string>
  /** Kept where it was on screen as the canvas layout changes around it. */
  toggledReplyId: string | null
}

export interface Expanded {
  ids: ReadonlySet<string>
  /** Kept where it was on screen as the canvas layout changes around it. */
  toggledTurnId: string | null
}

/** What every Turn on the canvas needs, without carrying it in node data. */
export interface CanvasState {
  treeId: string
  index: TreeIndex
  activeReplyId: string | null
  /** Its Thread becomes the Active Thread and the slideout closes. */
  onInputFocus: (replyId: string) => void
  /** A Prompt was sent into an Input and main started this Reply for it. */
  onSent: (replyId: string, parentReplyId: string | null) => void
  /** The Reply whose Input takes focus once it is drawn: the one just sent for. */
  inputToFocus: string | null
  /** Before main is asked, so the canvas is ready the moment the Turns go. */
  onDeleteConfirmed: (promptId: string) => void
  /** Chat mode on the Thread ending at this Reply. */
  openChat: (replyId: string) => void
  /** Kept here, not in the node, so it survives an orientation switch. */
  expandedTurnIds: ReadonlySet<string>
  toggleExpanded: (turnId: string) => void
  collapsedReplyIds: ReadonlySet<string>
  toggleCollapsed: (replyId: string) => void
  /** Kept here so a draft outlives its box folding or redrawing. */
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
