import type {TreeIndex} from './tree'

import {useCallback, useState} from 'react'

import {branchesOf, newestReply, turnsFrom} from './tree'

/** A Prompt confirmed for deletion, and what the canvas does once it's gone. */
interface Deletion {
  promptId: string
  /** Null for the root Prompt. */
  parentReplyId: string | null
  /** The Active Thread ran through the Prompt, so it moves up to the parent. */
  activeBelow: boolean
  /** The parent stops being a Fork, so its pill goes and its box shrinks. */
  resizes: boolean
}

function activeOf(
  index: TreeIndex,
  chosenReplyId: string | null,
  deleted: Deletion | null
) {
  if (chosenReplyId !== null && index.replyById.has(chosenReplyId)) {
    return chosenReplyId
  }

  const parentReplyId = deleted?.activeBelow ? deleted.parentReplyId : null

  return parentReplyId !== null && index.replyById.has(parentReplyId)
    ? parentReplyId
    : (newestReply(index)?.id ?? null)
}

/**
 * Noted before main is asked, so `deleted` turns up in the very render the
 * Turns leave the index: the Turns cache and React state update apart.
 */
export function useDeletion(index: TreeIndex, chosenReplyId: string | null) {
  const [deletion, setDeletion] = useState<Deletion | null>(null)

  const deleted =
    deletion !== null && !index.promptById.has(deletion.promptId)
      ? deletion
      : null

  const activeReplyId = activeOf(index, chosenReplyId, deleted)

  const onDeleteConfirmed = useCallback(
    (promptId: string) => {
      const parentReplyId =
        index.promptById.get(promptId)?.parentReplyId ?? null

      setDeletion({
        promptId,
        parentReplyId,
        activeBelow:
          activeReplyId !== null &&
          turnsFrom(index, promptId).includes(activeReplyId),
        resizes:
          parentReplyId !== null &&
          branchesOf(index, parentReplyId).length === 2,
      })
    },
    [index, activeReplyId]
  )

  return {deleted, activeReplyId, onDeleteConfirmed}
}
