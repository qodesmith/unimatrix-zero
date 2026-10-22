import type {Attempt, UserInput} from '#modules/sign-in/main'
import type {
  DownloadProgress,
  ProgramTarget,
} from '#modules/vendor-program/main'
import type {AppServer, OpenAppServer} from './app-server'
import type {SignInRequest} from '@uz/contract/host'
import type {SignInFinished, SignInUpdate} from '@uz/contract/providers'

import {createSignIn, getReady} from '#modules/sign-in/main'
import {SIGN_IN_CANCELED, signInFailed} from '@uz/contract/providers'

/** How long ChatGPT's page may take before connecting gives up. */
export const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

/**
 * What Codex says when the account's workspace can't use it: OpenAI's page
 * answers `missing_codex_entitlement` (`login/src/server.rs`, 0.163.0).
 */
const NOT_ENTITLED = 'Codex is not enabled for your workspace'

/** Codex's `PlanType` ids, as ChatGPT names those plans. */
const PLAN_NAMES = new Map([
  ['free', 'Free'],
  ['go', 'Go'],
  ['plus', 'Plus'],
  ['prolite', 'Pro'],
  ['pro', 'Pro'],
  ['promax', 'Pro'],
  ['team', 'Team'],
  ['business', 'Business'],
  ['enterprise', 'Enterprise'],
  ['edu', 'Edu'],
])

/** The plan's name; a plan this Codex doesn't name is shown as it reports it. */
function planName(planType: string) {
  return PLAN_NAMES.get(planType) ?? planType
}

type Input =
  | {kind: 'completed'; success: boolean; error: string | null}
  | {kind: 'exited'}
  | {kind: 'no-answer'}

export interface CodexSignInDeps {
  getProgramReady: (
    target: ProgramTarget,
    options: {signal: AbortSignal}
  ) => AsyncIterable<DownloadProgress>
  open: OpenAppServer
  timeoutMs: number
}

/** Reads the account Codex signed in with, and its plan. */
async function* checkPlan(
  attempt: Attempt<Input>,
  server: AppServer
): AsyncGenerator<SignInUpdate> {
  yield {type: 'SIGN_IN_STEP', step: 'check-plan'}

  const read = await server
    .request('account/read', {refreshToken: false})
    .catch(() => null)

  if (attempt.canceled()) {
    yield SIGN_IN_CANCELED

    return
  }

  const account = read?.account

  if (account?.type !== 'chatgpt' || account.planType === undefined) {
    yield signInFailed('failed', 'Couldn’t check your ChatGPT plan. Try again.')

    return
  }

  yield {
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account: {email: account.email ?? '', plan: planName(account.planType)},
  }
}

/**
 * Connecting ChatGPT: the exact Codex folder is put in place, then its
 * app-server signs in on ChatGPT's own page, with no code to paste, and
 * reports the account and its plan. Every ChatGPT plan can use Codex, so a
 * plan is refused only when Codex refuses the account's workspace.
 */
export function createCodexSignIn(deps: CodexSignInDeps) {
  /** Waits for the page to answer; the update to end with if it didn't. */
  async function* signInOnPage(
    {inbox}: Attempt<Input>,
    server: AppServer
  ): AsyncGenerator<SignInUpdate, SignInFinished | null> {
    const login = await server.request('account/login/start', {
      type: 'chatgpt',
    })

    const stop = server.listen(notification => {
      if (
        notification.method === 'account/login/completed' &&
        notification.params.loginId === login.loginId
      ) {
        const {success, error} = notification.params
        inbox.push({kind: 'completed', success, error})
      }
    })

    void server.exited.then(() => inbox.push({kind: 'exited'}))

    const timer = setTimeout(
      () => inbox.push({kind: 'no-answer'}),
      deps.timeoutMs
    )

    async function cancel() {
      await server
        .request('account/login/cancel', {loginId: login.loginId})
        .catch(() => undefined)
    }

    yield {type: 'SIGN_IN_STEP', step: 'sign-in-page', url: login.authUrl}

    try {
      for (;;) {
        const input: Input | UserInput = await inbox.next()

        if (input.kind === 'completed') {
          if (input.success) return null

          const message = input.error ?? 'ChatGPT’s page didn’t sign in.'

          return message.includes(NOT_ENTITLED)
            ? signInFailed('plan-refused', message)
            : signInFailed('no-answer', message)
        }

        if (input.kind === 'cancel') {
          await cancel()

          return SIGN_IN_CANCELED
        }

        if (input.kind === 'no-answer') {
          await cancel()

          return signInFailed('no-answer', 'ChatGPT’s page did not answer.')
        }

        if (input.kind === 'exited') {
          return signInFailed('failed', 'Codex stopped before you signed in.')
        }

        // Opening the page again shows the same page, and there is no code.
      }
    } finally {
      clearTimeout(timer)
      stop()
    }
  }

  async function* connect(
    attempt: Attempt<Input>,
    request: SignInRequest
  ): AsyncGenerator<SignInUpdate> {
    const {program} = request

    if (!program) throw new Error('The manifest names no Codex program.')

    const notReady = yield* getReady(
      attempt,
      deps.getProgramReady(program, {signal: attempt.signal})
    )

    if (notReady) {
      yield notReady

      return
    }

    const server = await deps.open(request)

    try {
      const ended = yield* signInOnPage(attempt, server)

      if (ended) yield ended
      else yield* checkPlan(attempt, server)
    } finally {
      await server.close()
    }
  }

  return createSignIn(connect)
}
