import type {TreeDeleteState} from './machine'

import {useStateMachine} from '#modules/state-machine/main'
import {useCallback} from 'react'

import {deleteTree} from './actions'
import {initialTreeDelete, treeDeleteTransition} from './machine'

function dialogView(state: TreeDeleteState) {
  switch (state.status) {
    case 'idle':
      return {open: false, deleting: false, error: null}
    case 'asking':
      return {open: true, deleting: false, error: null}
    case 'deleting':
      return {open: true, deleting: true, error: null}
    case 'refused':
      return {open: true, deleting: false, error: state.error}
    default:
      throw new Error('Unknown delete state.')
  }
}

/**
 * Deleting a Tree after asking, the same from its sidebar row and its root
 * Prompt. `dialog` is what `DeleteTreeDialog` takes.
 */
export function useTreeDelete(treeId: string) {
  const [state, send] = useStateMachine({
    transition: treeDeleteTransition,
    initial: initialTreeDelete,
  })

  const ask = useCallback(() => send({type: 'asked'}), [send])
  const cancel = useCallback(() => send({type: 'canceled'}), [send])

  function confirm() {
    if (treeDeleteTransition(state, {type: 'confirmed'}) === state) return

    send({type: 'confirmed'})
    void deleteTree({treeId, send})
  }

  return {
    ask,
    dialog: {...dialogView(state), onCancel: cancel, onConfirm: confirm},
  }
}
