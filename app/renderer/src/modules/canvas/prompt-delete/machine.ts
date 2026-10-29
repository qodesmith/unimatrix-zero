import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

export type PromptDeleteState =
  | {status: 'idle'}
  | {status: 'armed'}
  | {status: 'deleting'}
  | {status: 'refused'; error: string}

export type PromptDeleteEvent =
  | {type: 'armed'}
  | {type: 'canceled'}
  | {type: 'confirmed'}
  | {type: 'refused'; error: string}

export const initialPromptDelete: PromptDeleteState = {status: 'idle'}

const transitions = {
  idle: {armed: () => ({status: 'armed'})},
  armed: {
    canceled: () => initialPromptDelete,
    confirmed: () => ({status: 'deleting'}),
  },
  deleting: {
    refused: (_, {error}) => ({status: 'refused', error}),
  },
  refused: {
    canceled: () => initialPromptDelete,
    confirmed: () => ({status: 'deleting'}),
  },
} satisfies Transitions<PromptDeleteState, PromptDeleteEvent>

export const promptDeleteTransition = machine<
  PromptDeleteState,
  PromptDeleteEvent
>(transitions)
