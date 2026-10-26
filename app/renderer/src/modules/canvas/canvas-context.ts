import type {TreeIndex} from './tree'

import {createContext, use} from 'react'

export interface Collapsed {
  ids: ReadonlySet<string>
  /** Kept where it was on screen as the layout changes around it. */
  toggledReplyId: string | null
}

/** What every Turn on the canvas needs, without carrying it in node data. */
export interface CanvasState {
  treeId: string
  index: TreeIndex
  activeReplyId: string | null
  /** Its Thread becomes the Active Thread and the slideout closes. */
  onInputFocus: (replyId: string) => void
  /** A Prompt was sent into a Reply's Input and main started this Reply for it. */
  onSent: (replyId: string, parentReplyId: string) => void
  /** Kept here, not in the node, so it survives an orientation switch. */
  expandedTurnIds: ReadonlySet<string>
  toggleExpanded: (turnId: string) => void
  collapsedReplyIds: ReadonlySet<string>
  toggleCollapsed: (replyId: string) => void
  /** By Reply id; kept here so a draft outlives its box folding or redrawing. */
  drafts: ReadonlyMap<string, string>
  setDraft: (replyId: string, draft: string) => void
  limitTurnHeight: boolean
  contextSizeMeter: boolean
}

export const CanvasContext = createContext<CanvasState | null>(null)

export function useCanvas(): CanvasState {
  const state = use(CanvasContext)

  if (!state) throw new Error('Turn nodes render inside <Canvas> only')

  return state
}
