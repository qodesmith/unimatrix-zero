import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

export type ChatState =
  | {status: 'closed'}
  | {status: 'open'; turnId: string; followReplyId: string | null}
  | {status: 'closing'; turnId: string}

export type ChatEvent =
  | {type: 'opened'; turnId: string}
  | {type: 'dismissed'}
  | {type: 'slidOut'}
  | {type: 'sent'; replyId: string}
  | {type: 'arrived'; replyId: string}

export const initialChat: ChatState = {status: 'closed'}

function opened(_state: ChatState, {turnId}: {turnId: string}): ChatState {
  return {status: 'open', turnId, followReplyId: null}
}

const transitions = {
  closed: {opened},
  open: {
    opened,
    dismissed: ({turnId}) => ({status: 'closing', turnId}),
    sent: (state, {replyId}) => ({...state, followReplyId: replyId}),
    arrived: (state, {replyId}) =>
      replyId === state.followReplyId
        ? opened(state, {turnId: replyId})
        : state,
  },
  closing: {
    opened,
    slidOut: () => ({status: 'closed'}),
  },
} satisfies Transitions<ChatState, ChatEvent>

export const chatTransition = machine<ChatState, ChatEvent>(transitions)
