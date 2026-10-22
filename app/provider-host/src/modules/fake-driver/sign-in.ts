import type {Inbox} from '#modules/inbox/main'
import type {SignInUpdate} from '@uz/contract/providers'

import {createInbox} from '#modules/inbox/main'

/** The size the fake vendor program pretends to download. */
const PROGRAM_BYTES = 100_000_000

const DOWNLOAD_STEPS = 25

export const FAKE_SIGN_IN_URL = 'https://example.com/fake-sign-in'

/** The code the fake sign-in page shows. */
export const FAKE_CODE = 'fake-code'

/** A code that signs in to an account on a free plan. */
export const FAKE_FREE_CODE = 'fake-free'

export const FAKE_ACCOUNT = {email: 'fake@example.com', plan: 'Max'}

type Input =
  | {kind: 'page-opened'}
  | {kind: 'code'; code: string}
  | {kind: 'answered'}
  | {kind: 'cancel'}

interface Session {
  inbox: Inbox<Input>
  canceled: boolean
}

export interface FakeSignInOptions {
  /** The pause between steps. */
  delayMs: number
  /**
   * When the page the browser opened answers by itself, as Claude's does
   * through its local callback. Null: it never does, so only a code finishes.
   */
  answerMs: number | null
}

async function pause(ms: number) {
  if (ms === 0) return

  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** Read after a pause, during which a cancel may have arrived. */
function isCanceled(session: Session) {
  return session.canceled
}

const canceled: SignInUpdate = {type: 'SIGN_IN_FINISHED', outcome: 'canceled'}

/**
 * Connecting with no vendor behind it: a fake download, then a sign-in page
 * that answers by itself after a while, or takes a code once it is opened
 * again. `FAKE_CODE` signs in, `FAKE_FREE_CODE` signs in on a free plan, and
 * any other code is wrong.
 */
export function createFakeSignIn({delayMs, answerMs}: FakeSignInOptions) {
  let session: Session | null = null

  /**
   * Waits for the page or the user; the plan they signed in on, or null if
   * canceled.
   */
  async function* signInOnPage(
    current: Session
  ): AsyncGenerator<SignInUpdate, string | null> {
    const timer =
      answerMs === null
        ? undefined
        : setTimeout(() => current.inbox.push({kind: 'answered'}), answerMs)

    try {
      for (;;) {
        const input = await current.inbox.next()

        if (input.kind === 'cancel') return null

        if (input.kind === 'answered') return FAKE_ACCOUNT.plan

        if (input.kind === 'page-opened') {
          clearTimeout(timer)
          yield {
            type: 'SIGN_IN_STEP',
            step: 'paste-code',
            url: FAKE_SIGN_IN_URL,
          }
        } else if (input.code === FAKE_CODE) {
          return FAKE_ACCOUNT.plan
        } else if (input.code === FAKE_FREE_CODE) {
          return 'Free'
        } else {
          yield {
            type: 'SIGN_IN_STEP',
            step: 'paste-code',
            url: FAKE_SIGN_IN_URL,
            wrongCode: true,
          }
        }
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function* signIn(): AsyncGenerator<SignInUpdate> {
    const current: Session = {inbox: createInbox<Input>(), canceled: false}
    session = current

    try {
      for (let step = 0; step <= DOWNLOAD_STEPS; step++) {
        if (current.canceled) {
          yield canceled

          return
        }

        yield {
          type: 'SIGN_IN_STEP',
          step: 'get-ready',
          progress: {
            receivedBytes: (PROGRAM_BYTES / DOWNLOAD_STEPS) * step,
            totalBytes: PROGRAM_BYTES,
          },
        }
        await pause(delayMs)
      }

      if (current.canceled) {
        yield canceled

        return
      }

      yield {type: 'SIGN_IN_STEP', step: 'sign-in-page', url: FAKE_SIGN_IN_URL}

      const plan = yield* signInOnPage(current)

      if (plan === null) {
        yield canceled

        return
      }

      yield {type: 'SIGN_IN_STEP', step: 'check-plan'}
      await pause(delayMs * 10)

      if (isCanceled(current)) {
        yield canceled

        return
      }

      if (plan === 'Free') {
        yield {
          type: 'SIGN_IN_FINISHED',
          outcome: 'failed',
          failure: {
            reason: 'free-plan',
            message: 'The fake account is on a free plan.',
          },
        }

        return
      }

      yield {
        type: 'SIGN_IN_FINISHED',
        outcome: 'connected',
        account: FAKE_ACCOUNT,
      }
    } finally {
      if (session === current) session = null
    }
  }

  return {
    signIn,
    signInPageOpened: () => session?.inbox.push({kind: 'page-opened'}),
    submitSignInCode: (code: string) =>
      session?.inbox.push({kind: 'code', code}),
    cancelSignIn: () => {
      if (!session) return

      session.canceled = true
      session.inbox.push({kind: 'cancel'})
    },
  }
}
