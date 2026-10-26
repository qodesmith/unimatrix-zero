import type {MachineEvent, MachineState} from './machine'

import {useReducer} from 'react'

/** Runs a machine from `machine()` in this component. */
export function useStateMachine<
  S extends MachineState,
  E extends MachineEvent,
>({transition, initial}: {transition: (state: S, event: E) => S; initial: S}) {
  return useReducer(transition, initial)
}
