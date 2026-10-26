import type {Attempt} from '#modules/sign-in/main'
import type {SignInUpdate} from '@uz/contract/providers'

import {createSignIn} from '#modules/sign-in/main'
import {SIGN_IN_CANCELED, signInFailed} from '@uz/contract/providers'

const PROGRAM_BYTES = 100_000_000

const DOWNLOAD_STEPS = 25

export const FAKE_SIGN_IN_URL = 'https://example.com/fake-sign-in'

export const FAKE_CODE = 'fake-code'

export const FAKE_FREE_CODE = 'fake-free'

export const FAKE_ACCOUNT = {email: 'fake@example.com', plan: 'Max'}

interface Input {
  kind: 'answered'
}

export interface FakeSignInOptions {
  delayMs: number
  /** Null: the page never answers by itself, so only a code finishes. */
  answerMs: number | null
}

async function pause(ms: number) {
  if (ms === 0) return

  await new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/** Connecting with no vendor: a fake download, then a fake sign-in page. */
export function createFakeSignIn({delayMs, answerMs}: FakeSignInOptions) {
  /** The plan signed in on, or null if canceled. */
  async function* signInOnPage({
    inbox,
  }: Attempt<Input>): AsyncGenerator<SignInUpdate, string | null> {
    const timer =
      answerMs === null
        ? undefined
        : setTimeout(() => inbox.push({kind: 'answered'}), answerMs)

    try {
      for (;;) {
        const input = await inbox.next()

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

  async function* connect(
    attempt: Attempt<Input>
  ): AsyncGenerator<SignInUpdate> {
    for (let step = 0; step <= DOWNLOAD_STEPS; step++) {
      if (attempt.canceled()) {
        yield SIGN_IN_CANCELED

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

    if (attempt.canceled()) {
      yield SIGN_IN_CANCELED

      return
    }

    yield {type: 'SIGN_IN_STEP', step: 'sign-in-page', url: FAKE_SIGN_IN_URL}

    const plan = yield* signInOnPage(attempt)

    if (plan === null) {
      yield SIGN_IN_CANCELED

      return
    }

    yield {type: 'SIGN_IN_STEP', step: 'check-plan'}
    await pause(delayMs * 10)

    if (attempt.canceled()) {
      yield SIGN_IN_CANCELED

      return
    }

    if (plan === 'Free') {
      yield signInFailed('plan-refused', 'The fake account is on a free plan.')

      return
    }

    yield {
      type: 'SIGN_IN_FINISHED',
      outcome: 'connected',
      account: FAKE_ACCOUNT,
    }
  }

  return createSignIn(connect)
}
