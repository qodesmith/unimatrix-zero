import {useStateMachine} from '#modules/state-machine/main'
import {deleteTree} from '#modules/trees/main'
import {useDeletePrompt} from '#modules/turns/main'
import {useCallback, useMemo} from 'react'

import {useCanvas} from '../canvas-context'
import {turnsFrom} from '../tree'
import {askToDelete} from './actions'
import {initialPromptDelete, promptDeleteTransition} from './machine'

/**
 * Deleting a Prompt and every Turn below it, offered only while none of those
 * Replies streams: main refuses then too. Deleting the root Prompt deletes
 * the Tree, the same as deleting it from the sidebar.
 */
export function usePromptDelete(promptId: string) {
  const {treeId, index, onDeleteConfirmed} = useCanvas()
  const deletePrompt = useDeletePrompt(treeId)

  const [state, send] = useStateMachine({
    transition: promptDeleteTransition,
    initial: initialPromptDelete,
  })

  const turnIds = useMemo(() => turnsFrom(index, promptId), [index, promptId])

  const offered = !turnIds.some(
    id => index.replyById.get(id)?.status === 'streaming'
  )

  const isRoot = index.promptById.get(promptId)?.parentReplyId === null

  const arm = useCallback(() => send({type: 'armed'}), [send])
  const cancel = useCallback(() => send({type: 'canceled'}), [send])

  function confirm() {
    if (promptDeleteTransition(state, {type: 'confirmed'}) === state) return

    send({type: 'confirmed'})

    if (isRoot) {
      void askToDelete({runDelete: async () => deleteTree(treeId), send})
    } else {
      onDeleteConfirmed(promptId)
      void askToDelete({runDelete: async () => deletePrompt(promptId), send})
    }
  }

  return {
    state,
    offered,
    isRoot,
    turnCount: turnIds.length,
    arm,
    cancel,
    confirm,
  }
}
