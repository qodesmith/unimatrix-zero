import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

/** A dialog that asks, then sends main one command it may refuse. */
export type DialogCommandState =
  | {status: 'idle'}
  | {status: 'asking'}
  | {status: 'running'}
  | {status: 'refused'; error: string}

export type DialogCommandEvent =
  | {type: 'asked'}
  | {type: 'canceled'}
  | {type: 'confirmed'}
  | {type: 'succeeded'}
  | {type: 'refused'; error: string}

export const initialDialogCommand: DialogCommandState = {status: 'idle'}

const transitions = {
  idle: {asked: () => ({status: 'asking'})},
  asking: {
    canceled: () => initialDialogCommand,
    confirmed: () => ({status: 'running'}),
  },
  running: {
    succeeded: () => initialDialogCommand,
    refused: (_, {error}) => ({status: 'refused', error}),
  },
  refused: {
    canceled: () => initialDialogCommand,
    confirmed: () => ({status: 'running'}),
  },
} satisfies Transitions<DialogCommandState, DialogCommandEvent>

export const dialogCommandTransition = machine<
  DialogCommandState,
  DialogCommandEvent
>(transitions)
