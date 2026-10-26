import type {Transitions} from '#modules/state-machine/main'

import {machine} from '#modules/state-machine/main'

/** What the user has asked of a Reply's run, shared by its controls and Esc. */
export type ReplyRunState =
  | {status: 'idle'}
  | {status: 'stopping'}
  | {status: 'stopRefused'; error: string}
  | {status: 'retrying'}
  | {status: 'retryRefused'; error: string}

export type ReplyRunEvent =
  | {type: 'stopAsked'}
  | {type: 'stopRefused'; error: string}
  | {type: 'retryAsked'}
  | {type: 'retryAccepted'}
  | {type: 'retryRefused'; error: string}
  | {type: 'runStarted'}
  | {type: 'runFinished'}

export const initialReplyRun: ReplyRunState = {status: 'idle'}

const transitions = {
  idle: {
    stopAsked: () => ({status: 'stopping'}),
    retryAsked: () => ({status: 'retrying'}),
  },
  stopping: {
    stopRefused: (_, {error}) => ({status: 'stopRefused', error}),
    runFinished: () => initialReplyRun,
  },
  stopRefused: {
    stopAsked: () => ({status: 'stopping'}),
    runStarted: () => initialReplyRun,
    runFinished: () => initialReplyRun,
  },
  retrying: {
    retryAccepted: () => initialReplyRun,
    retryRefused: (_, {error}) => ({status: 'retryRefused', error}),
    runFinished: () => initialReplyRun,
  },
  retryRefused: {
    retryAsked: () => ({status: 'retrying'}),
    runStarted: () => initialReplyRun,
    runFinished: () => initialReplyRun,
  },
} satisfies Transitions<ReplyRunState, ReplyRunEvent>

export const replyRunTransition = machine<ReplyRunState, ReplyRunEvent>(
  transitions
)
