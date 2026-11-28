import type {MachineEvent, MachineState} from '@uz/contract/state-machine'

import {useReducer} from 'react'

export function useStateMachine<
  S extends MachineState,
  E extends MachineEvent,
>({transition, initial}: {transition: (state: S, event: E) => S; initial: S}) {
  return useReducer(transition, initial)
}
