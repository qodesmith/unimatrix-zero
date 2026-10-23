import type {TreeIndex} from './tree'
import type {Dispatch, SetStateAction} from 'react'

import {createContext, use} from 'react'

/** What every Turn on the canvas needs, without carrying it in node data. */
export interface CanvasState {
  treeId: string
  index: TreeIndex
  activeReplyId: string | null
  setActiveReplyId: (replyId: string) => void
  /** The Reply whose Input the user is typing into. */
  setTypingReplyId: Dispatch<SetStateAction<string | null>>
  /** A Prompt was sent and main started this Reply for it. */
  onSent: (replyId: string) => void
  limitTurnHeight: boolean
  contextSizeMeter: boolean
}

export const CanvasContext = createContext<CanvasState | null>(null)

export function useCanvas(): CanvasState {
  const state = use(CanvasContext)

  if (!state) throw new Error('Turn nodes render inside <Canvas> only')

  return state
}
