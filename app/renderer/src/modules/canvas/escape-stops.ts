import type {TreeIndex} from './tree'
import type {Reply} from '@uz/contract/turns'

import {useReply, useReplyRun} from '#modules/turns/main'
import {useEffect} from 'react'

import {dialogOpen} from './dialog-open'

interface EscapeStops {
  treeId: string
  index: TreeIndex
  activeReplyId: string | null
  chatOpen: boolean
  /** The Reply the slideout ends at, kept while it slides away. */
  chatEnd: Reply | null
}

/**
 * Esc stops the streaming Reply in view, the slideout's end else the Active
 * Thread's, capturing the key before the slideout closes on it.
 */
export function useEscapeStops({
  treeId,
  index,
  activeReplyId,
  chatOpen,
  chatEnd,
}: EscapeStops) {
  const replyId = chatOpen && chatEnd ? chatEnd.id : activeReplyId

  const shown = useReply(
    replyId === null ? null : (index.replyById.get(replyId) ?? null)
  )

  const status = shown?.status

  const streaming = status === 'streaming' ? replyId : null
  const {stop} = useReplyRun(treeId, streaming)

  useEffect(() => {
    if (streaming === null) return undefined

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || dialogOpen()) {
        return
      }

      const {target} = event

      if (target instanceof Element && target.closest('input, textarea')) {
        return
      }

      event.preventDefault()
      stop()
    }

    globalThis.addEventListener('keydown', onKeyDown, true)

    return () => globalThis.removeEventListener('keydown', onKeyDown, true)
  }, [streaming, stop])
}
