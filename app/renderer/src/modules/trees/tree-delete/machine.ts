import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

export type TreeDeleteState =
  | {status: 'idle'}
  | {status: 'asking'}
  | {status: 'deleting'}
  | {status: 'refused'; error: string}

export type TreeDeleteEvent =
  | {type: 'asked'}
  | {type: 'canceled'}
  | {type: 'confirmed'}
  | {type: 'refused'; error: string}

export const initialTreeDelete: TreeDeleteState = {status: 'idle'}

const transitions = {
  idle: {asked: () => ({status: 'asking'})},
  asking: {
    canceled: () => initialTreeDelete,
    confirmed: () => ({status: 'deleting'}),
  },
  deleting: {
    refused: (_, {error}) => ({status: 'refused', error}),
  },
  refused: {
    canceled: () => initialTreeDelete,
    confirmed: () => ({status: 'deleting'}),
  },
} satisfies Transitions<TreeDeleteState, TreeDeleteEvent>

export const treeDeleteTransition = machine<TreeDeleteState, TreeDeleteEvent>(
  transitions
)
