import type {Inbox} from '#modules/inbox/main'
import type {DownloadProgress} from '#modules/vendor-program/main'
import type {SignInRequest} from '@uz/contract/host'
import type {SignInFinished, SignInUpdate} from '@uz/contract/providers'

import {createInbox} from '#modules/inbox/main'
import {SIGN_IN_CANCELED, signInFailed} from '@uz/contract/providers'

/** What the user does while connecting, as main passes it on. */
export type UserInput =
  | {kind: 'page-opened'}
  | {kind: 'code'; code: string}
  | {kind: 'cancel'}

/** One go at connecting, from Connect to its end. */
export interface Attempt<Input extends object> {
  inbox: Inbox<Input | UserInput>
  /** Aborted by cancel. */
  signal: AbortSignal
  /** A function so it is read afresh after each wait. */
  canceled: () => boolean
}

/**
 * Returns the update to end with when the download failed or the user
 * canceled; null once the program is ready.
 */
export async function* getReady(
  attempt: Pick<Attempt<object>, 'canceled'>,
  download: AsyncIterable<DownloadProgress>
): AsyncGenerator<SignInUpdate, SignInFinished | null> {
  yield {type: 'SIGN_IN_STEP', step: 'get-ready'}

  try {
    for await (const progress of download) {
      yield {type: 'SIGN_IN_STEP', step: 'get-ready', progress}
    }
  } catch (error) {
    if (attempt.canceled()) return SIGN_IN_CANCELED

    return signInFailed(
      'download-failed',
      error instanceof Error ? error.message : String(error)
    )
  }

  return attempt.canceled() ? SIGN_IN_CANCELED : null
}

/** Each `signIn` is a new go at connecting; the user's input goes to the latest. */
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
