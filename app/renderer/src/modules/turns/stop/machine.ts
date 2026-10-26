import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

/** A streaming Reply's Stop, shared by its button and Esc. */
export type StopState =
  | {status: 'streaming'}
  | {status: 'stopping'}
  | {status: 'refused'; error: string}

export type StopEvent = {type: 'asked'} | {type: 'refused'; error: string}

export const initialStop: StopState = {status: 'streaming'}

const transitions = {
  streaming: {
    asked: () => ({status: 'stopping'}),
  },
  stopping: {
    refused: (_, {error}) => ({status: 'refused', error}),
  },
  refused: {
    asked: () => ({status: 'stopping'}),
  },
} satisfies Transitions<StopState, StopEvent>

export const stopTransition = machine<StopState, StopEvent>(transitions)
