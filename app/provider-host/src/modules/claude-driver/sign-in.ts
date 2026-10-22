import type {Attempt, UserInput} from '#modules/sign-in/main'
import type {
  DownloadProgress,
  ProgramTarget,
} from '#modules/vendor-program/main'
import type {ClaudeCommand, Login, LoginEvents} from './login'
import type {AccountInfo} from '@anthropic-ai/claude-agent-sdk'
import type {SignInRequest} from '@uz/contract/host'
import type {SignInFinished, SignInUpdate} from '@uz/contract/providers'

import {createSignIn, getReady} from '#modules/sign-in/main'
import {SIGN_IN_CANCELED, signInFailed} from '@uz/contract/providers'

import {planOf} from './account'
import {claudeEnvironment} from './environment'

/** How long the sign-in page may take before connecting gives up. */
export const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

type Input =
  | {kind: 'url'; run: number; url: string}
  | {kind: 'exit'; run: number; code: number | null; output: string}
  | {kind: 'no-answer'}

type PageStep = Extract<SignInUpdate, {type: 'SIGN_IN_STEP'}>

/** The sign-in page as the user has seen it so far. */
interface Page {
  /** Which run of `claude auth login` is current. */
  run: number
  url: string | null
  /** Opened again by the app, so it shows a code. */
  opened: boolean
  pasted: boolean
  /** Claude refused the last code. */
  refused: boolean
}

/** What one input does: an update to show, or the end of signing in. */
interface Reaction {
  update?: SignInUpdate
  end?: SignInFinished | 'signed-in'
}

export interface ClaudeSignInDeps {
  getProgramReady: (
    target: ProgramTarget,
    options: {signal: AbortSignal}
  ) => AsyncIterable<DownloadProgress>
  /** How to run the vendor program at `path`. */
  commandFor: (path: string) => ClaudeCommand
  startLogin: (
    command: ClaudeCommand,
    env: Record<string, string>,
    events: LoginEvents
  ) => Login
  readAccount: (options: {
    program: string
    env: Record<string, string>
    cwd: string
  }) => Promise<AccountInfo>
  signOut: (
    command: ClaudeCommand,
    env: Record<string, string>
  ) => Promise<void>
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

/**
 * Whether a pasted code belongs to this sign-in: Claude's page shows the code
 * followed by `#` and the state in the page's own link.
 */
function belongsTo(code: string, url: string) {
  const state = new URL(url).searchParams.get('state')

  return (
    state !== null &&
    code.length > state.length + 1 &&
    code.endsWith(`#${state}`)
  )
}

/**
 * The step the sign-in page is at, for the card; without a link while a new
 * login replaces one whose code Claude refused.
 */
function pageStep({url, opened, refused}: Page): PageStep {
  const step: PageStep = {
    type: 'SIGN_IN_STEP',
    step: opened || refused ? 'paste-code' : 'sign-in-page',
  }

  if (url) step.url = url

  if (refused) step.wrongCode = true

  return step
}

/**
 * Connecting Claude: the exact vendor program is put in place, then the
 * unmodified `claude auth login` signs in on Claude's own page, and one
 * session reports the account and its plan. A free account is signed out
 * again, so trying again can use a different one.
 */
export function createClaudeSignIn(deps: ClaudeSignInDeps) {
  /**
   * Runs `claude auth login` until it signs in; the update to end with if it
   * doesn't.
   */
  async function* signInOnPage(
    {inbox}: Attempt<Input>,
    command: ClaudeCommand,
    env: Record<string, string>
  ): AsyncGenerator<SignInUpdate, SignInFinished | null> {
    const page: Page = {
      run: 0,
      url: null,
      opened: false,
      pasted: false,
      refused: false,
    }

    function start() {
      page.run += 1
      const {run} = page

      return deps.startLogin(command, env, {
        onUrl: url => inbox.push({kind: 'url', run, url}),
        onExit: (code, output) => inbox.push({kind: 'exit', run, code, output}),
      })
    }

    let login = start()

    function onPageOpened(): Reaction {
      if (!page.url) return {}

      page.opened = true
      page.refused = false

      return {update: pageStep(page)}
    }

    function onCode(pasted: string): Reaction {
      const code = pasted.trim()

      if (!page.url) return {}

      if (!belongsTo(code, page.url)) {
        return {update: {...pageStep(page), wrongCode: true}}
      }

      page.pasted = true
      login.enterCode(code)

      return {}
    }

    function onExit(code: number | null, output: string): Reaction {
      if (code === 0) return {end: 'signed-in'}

      if (!page.pasted) {
        return {
          end: signInFailed(
            'no-answer',
            output || 'Sign-in ended before Claude’s page answered.'
          ),
        }
      }

      // Claude refused the code, and this login can't take another: a new
      // one opens its own page and prints a new one. The old page is dead
      // from here, so the card loses its link until then.
      Object.assign(page, {pasted: false, refused: true, url: null})
      login = start()

      return {update: pageStep(page)}
    }

    function react(input: Input | UserInput): Reaction {
      if (input.kind === 'url') {
        page.url = input.url

        return {update: pageStep(page)}
      }

      if (input.kind === 'page-opened') return onPageOpened()

      if (input.kind === 'code') return onCode(input.code)

      if (input.kind === 'exit') return onExit(input.code, input.output)

      // Canceled, or the page never answered: this login is over.
      login.kill()

      return {
        end:
          input.kind === 'cancel'
            ? SIGN_IN_CANCELED
            : signInFailed('no-answer', 'Claude’s page did not answer.'),
      }
    }

    const timer = setTimeout(
      () => inbox.push({kind: 'no-answer'}),
      deps.timeoutMs
    )

    try {
      for (;;) {
        const input = await inbox.next()

        // From a login that was replaced after Claude refused a code.
        if ('run' in input && input.run !== page.run) continue

        const {update, end} = react(input)

        if (update) yield update

        if (end) return end === 'signed-in' ? null : end
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function* connect(
    attempt: Attempt<Input>,
    request: SignInRequest
  ): AsyncGenerator<SignInUpdate> {
    const {program, configDir} = request

    if (!program) throw new Error('The manifest names no Claude program.')

    const notReady = yield* getReady(
      attempt,
      deps.getProgramReady(program, {signal: attempt.signal})
    )

    if (notReady) {
      yield notReady

      return
    }

    const env = claudeEnvironment(deps.env, configDir)
    const command = deps.commandFor(program.path)
    const ended = yield* signInOnPage(attempt, command, env)

    if (ended) {
      yield ended

      return
    }

    yield {type: 'SIGN_IN_STEP', step: 'check-plan'}

    const account = await deps
      .readAccount({program: program.path, env, cwd: configDir})
      .catch(() => null)

    // Canceled while the plan was read, which is never cut short.
    if (attempt.canceled()) {
      yield SIGN_IN_CANCELED

      return
    }

    // No plan at all, not even "Claude API", means it wasn't read.
    if (account?.subscriptionType === undefined) {
      yield signInFailed(
        'failed',
        'Couldn’t check your Claude plan. Try again.'
      )

      return
    }

    const plan = planOf(account.subscriptionType)

    if (!plan) {
      // Signed out so another account can be used; if that fails, the
      // next sign-in replaces this one anyway.
      await deps.signOut(command, env).catch(() => undefined)
      yield signInFailed(
        'plan-refused',
        'This Claude account has no Pro or Max plan.'
      )

      return
    }

    yield {
      type: 'SIGN_IN_FINISHED',
      outcome: 'connected',
      account: {email: account.email ?? '', plan},
    }
  }

  return createSignIn(connect)
}
