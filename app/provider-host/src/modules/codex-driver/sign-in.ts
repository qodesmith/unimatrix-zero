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

export const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

/** Starting a sign-in while another holds this port makes Codex cancel that one. */
const SIGN_IN_PORT = 1455

/** Codex's message when OpenAI's page answers `missing_codex_entitlement`. */
const NOT_ENTITLED = 'Codex is not enabled for your workspace'

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
  portFree: (port: number) => Promise<boolean>
  timeoutMs: number
}

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

/** Connecting ChatGPT; every plan can use Codex unless its workspace is refused. */
export function createCodexSignIn(deps: CodexSignInDeps) {
  /** Null once signed in, else the update to end with. */
  async function* signInOnPage(
    {inbox}: Attempt<Input>,
    server: AppServer
  ): AsyncGenerator<SignInUpdate, SignInFinished | null> {
    if (!(await deps.portFree(SIGN_IN_PORT))) {
      return signInFailed(
        'failed',
        'Another ChatGPT or Codex sign-in is open. Finish or close it, then try again.'
      )
    }

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

    // Codex's app-server leaves opening the page to the app.
    yield {
      type: 'SIGN_IN_STEP',
      step: 'sign-in-page',
      url: login.authUrl,
      openPage: true,
    }

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

        // Reopening the page shows the same page, and there is no code to paste.
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
