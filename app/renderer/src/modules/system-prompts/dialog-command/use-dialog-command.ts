import type {DialogCommandState} from './machine'
import type {CommandOutcome, CommandType} from '@uz/contract/commands'

import {useStateMachine} from '#modules/state-machine/main'
import {useCallback} from 'react'

import {runCommand} from './actions'
import {dialogCommandTransition, initialDialogCommand} from './machine'

function dialogView(state: DialogCommandState) {
  switch (state.status) {
    case 'idle':
      return {open: false, running: false, error: null}
    case 'asking':
      return {open: true, running: false, error: null}
    case 'running':
      return {open: true, running: true, error: null}
    case 'refused':
      return {open: true, running: false, error: state.error}
    default:
      throw new Error('Unknown dialog state.')
  }
}

export function useDialogCommand() {
  const [state, send] = useStateMachine({
    transition: dialogCommandTransition,
    initial: initialDialogCommand,
  })

  const ask = useCallback(() => send({type: 'asked'}), [send])
  const cancel = useCallback(() => send({type: 'canceled'}), [send])

  function confirm(run: () => Promise<CommandOutcome<CommandType>>) {
    if (dialogCommandTransition(state, {type: 'confirmed'}) === state) return

    send({type: 'confirmed'})
    void runCommand({run, send})
  }

  return {...dialogView(state), ask, cancel, confirm}
}
