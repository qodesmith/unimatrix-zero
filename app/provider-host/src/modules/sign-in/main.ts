import type {Inbox} from '#modules/inbox/main'
import type {SignInRequest} from '@uz/contract/host'
import type {SignInUpdate} from '@uz/contract/providers'

import {createInbox} from '#modules/inbox/main'

/** What the user does while connecting, as main passes it on. */
export type UserInput =
  | {kind: 'page-opened'}
  | {kind: 'code'; code: string}
  | {kind: 'cancel'}

/** One go at connecting, from Connect to its end. */
export interface Attempt<Input extends object> {
  /** The user's input, and the driver's own `Input`. */
  inbox: Inbox<Input | UserInput>
  /** Aborted by cancel, to stop work under way such as a download. */
  signal: AbortSignal
  /** A function so it is read afresh after each wait. */
  canceled: () => boolean
}

/**
 * A driver's `signIn` and the controls that reach it: each `signIn` is a new
 * go at connecting, and the user's input goes to the latest.
 */
export function createSignIn<Input extends object>(
  connect: (
    attempt: Attempt<Input>,
    request: SignInRequest
  ) => AsyncGenerator<SignInUpdate>
) {
  let current: {attempt: Attempt<Input>; abort: AbortController} | null = null

  async function* signIn(request: SignInRequest): AsyncGenerator<SignInUpdate> {
    const abort = new AbortController()
    const {signal} = abort

    const go = {
      attempt: {
        inbox: createInbox<Input | UserInput>(),
        signal,
        canceled: () => signal.aborted,
      },
      abort,
    }

    current = go

    try {
      yield* connect(go.attempt, request)
    } finally {
      if (current === go) current = null
    }
  }

  return {
    signIn,
    signInPageOpened: () => current?.attempt.inbox.push({kind: 'page-opened'}),
    submitSignInCode: (code: string) =>
      current?.attempt.inbox.push({kind: 'code', code}),
    cancelSignIn: () => {
      current?.abort.abort()
      current?.attempt.inbox.push({kind: 'cancel'})
    },
  }
}
