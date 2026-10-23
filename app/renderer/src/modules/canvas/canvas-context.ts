import type {TreeIndex} from './tree'

import {createContext, use} from 'react'

/** Forks folded through their pill, and the one toggled last. */
export interface Collapsed {
  /** Their Branches are left off the canvas. */
  ids: ReadonlySet<string>
  /** Kept where it was on screen as the layout changes around it. */
  toggledReplyId: string | null
}

/** What every Turn on the canvas needs, without carrying it in node data. */
export interface CanvasState {
  treeId: string
  index: TreeIndex
  activeReplyId: string | null
  setActiveReplyId: (replyId: string) => void
  /** A Prompt was sent and main started this Reply for it. */
  onSent: (replyId: string) => void
  /**
   * Turns the user let out of their capped height; kept here so they survive an
   * orientation switch.
   */
  expandedTurnIds: ReadonlySet<string>
  toggleExpanded: (turnId: string) => void
  /** Forks folded through their pill: their Branches are left off the canvas. */
  collapsedReplyIds: ReadonlySet<string>
  toggleCollapsed: (replyId: string) => void
  limitTurnHeight: boolean
  contextSizeMeter: boolean
}

export const CanvasContext = createContext<CanvasState | null>(null)

export function useCanvas(): CanvasState {
  const state = use(CanvasContext)

  if (!state) throw new Error('Turn nodes render inside <Canvas> only')

  return state
}
