import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

/** One file on its way into a draft, from the moment it is attached. */
export type AttachmentAddState =
  | {status: 'adding'; name: string}
  | {status: 'added'}
  | {status: 'refused'; name: string; error: string}

export type AttachmentAddEvent =
  | {type: 'added'}
  | {type: 'refused'; error: string}

export function startedAdding(name: string): AttachmentAddState {
  return {status: 'adding', name}
}

const transitions = {
  adding: {
    added: () => ({status: 'added'}),
    refused: ({name}, {error}) => ({status: 'refused', name, error}),
  },
  added: {},
  refused: {},
} satisfies Transitions<AttachmentAddState, AttachmentAddEvent>

export const attachmentAddTransition = machine<
  AttachmentAddState,
  AttachmentAddEvent
>(transitions)
