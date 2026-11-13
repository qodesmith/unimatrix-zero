import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

export type PromptSendState =
  | {status: 'idle'}
  | {status: 'sending'}
  | {status: 'refused'; error: string}

export type PromptSendEvent =
  | {type: 'submitted'}
  | {type: 'sent'}
  | {type: 'refused'; error: string}

export const initialPromptSend: PromptSendState = {status: 'idle'}

const transitions = {
  idle: {submitted: () => ({status: 'sending'})},
  sending: {
    sent: () => initialPromptSend,
    refused: (_, {error}) => ({status: 'refused', error}),
  },
  refused: {submitted: () => ({status: 'sending'})},
} satisfies Transitions<PromptSendState, PromptSendEvent>

export const promptSendTransition = machine<PromptSendState, PromptSendEvent>(
  transitions
)
