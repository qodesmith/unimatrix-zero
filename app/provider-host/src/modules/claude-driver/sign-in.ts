import type {Inbox} from '#modules/inbox/main'
import type {ClaudeCommand, Login, LoginEvents} from './login'
import type {DownloadProgress} from './program'
import type {AccountInfo} from '@anthropic-ai/claude-agent-sdk'
import type {SignInRequest} from '@uz/contract/host'
import type {VendorBuild} from '@uz/contract/manifest'
import type {SignInUpdate} from '@uz/contract/providers'

import {createInbox} from '#modules/inbox/main'

import {planOf} from './account'
import {claudeEnvironment} from './environment'

/** How long the sign-in page may take before connecting gives up. */
export const SIGN_IN_TIMEOUT_MS = 15 * 60 * 1000

type Input =
  | {kind: 'url'; attempt: number; url: string}
  | {kind: 'exit'; attempt: number; code: number | null; output: string}
  | {kind: 'page-opened'}
  | {kind: 'code'; code: string}
  | {kind: 'cancel'}
  | {kind: 'no-answer'}

type PageStep = Extract<SignInUpdate, {type: 'SIGN_IN_STEP'}>

/** The sign-in page as the user has seen it so far. */
interface Page {
  /** Which run of `claude auth login` is current. */
  attempt: number
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
  end?: SignInUpdate | 'signed-in'
}

interface Session {
  inbox: Inbox<Input>
  abort: AbortController
}

export interface ClaudeSignInDeps {
  getProgramReady: (
    target: {path: string; build: VendorBuild},
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

const canceled: SignInUpdate = {type: 'SIGN_IN_FINISHED', outcome: 'canceled'}

function failed(
  reason: 'download-failed' | 'no-answer' | 'free-plan',
  message: string
): SignInUpdate {
  return {
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason, message},
  }
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

/** The step the sign-in page is at, for the card. */
function pageStep(page: Page, url: string): PageStep {
  if (page.refused) {
    return {type: 'SIGN_IN_STEP', step: 'paste-code', url, wrongCode: true}
  }

  return {
    type: 'SIGN_IN_STEP',
    step: page.opened ? 'paste-code' : 'sign-in-page',
    url,
  }
}

/**
 * Connecting Claude: the exact vendor program is put in place, then the
 * unmodified `claude auth login` signs in on Claude's own page, and one
 * session reports the account and its plan. A free account is signed out
 * again, so trying again can use a different one.
 */
export function createClaudeSignIn(deps: ClaudeSignInDeps) {
  let session: Session | null = null

  /**
   * Runs `claude auth login` until it signs in; the update to end with if it
   * doesn't.
   */
  async function* signInOnPage(
    {inbox}: Session,
    command: ClaudeCommand,
    env: Record<string, string>
  ): AsyncGenerator<SignInUpdate, SignInUpdate | null> {
    const page: Page = {
      attempt: 0,
      url: null,
      opened: false,
      pasted: false,
      refused: false,
    }

    function start() {
      page.attempt += 1
      const {attempt} = page

      return deps.startLogin(command, env, {
        onUrl: url => inbox.push({kind: 'url', attempt, url}),
        onExit: (code, output) =>
          inbox.push({kind: 'exit', attempt, code, output}),
      })
    }

    let login = start()

    function onPageOpened(): Reaction {
      if (!page.url) return {}

      page.opened = true
      page.refused = false

      return {update: pageStep(page, page.url)}
    }

    function onCode(pasted: string): Reaction {
      const code = pasted.trim()

      if (!page.url) return {}

      if (!belongsTo(code, page.url)) {
        return {update: {...pageStep(page, page.url), wrongCode: true}}
      }

      page.pasted = true
      login.enterCode(code)

      return {}
    }

    function onExit(code: number | null, output: string): Reaction {
      if (code === 0) return {end: 'signed-in'}

      if (!page.pasted) {
        return {
          end: failed(
            'no-answer',
            output || 'Sign-in ended before Claude’s page answered.'
          ),
        }
      }

      // Claude refused the code, and this login can't take another: a new
      // one opens its own page and prints a new one.
      Object.assign(page, {pasted: false, refused: true, url: null})
      login = start()

      return {}
    }

    function react(input: Input): Reaction {
      if (input.kind === 'url') {
        page.url = input.url

        return {update: pageStep(page, input.url)}
      }

      if (input.kind === 'page-opened') return onPageOpened()

      if (input.kind === 'code') return onCode(input.code)

      if (input.kind === 'exit') return onExit(input.code, input.output)

      // Canceled, or the page never answered: this login is over.
      login.kill()

      return {
        end:
          input.kind === 'cancel'
            ? canceled
            : failed('no-answer', 'Claude’s page did not answer.'),
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
        if ('attempt' in input && input.attempt !== page.attempt) continue

        const {update, end} = react(input)

        if (update) yield update

        if (end) return end === 'signed-in' ? null : end
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async function* signIn(request: SignInRequest): AsyncGenerator<SignInUpdate> {
    const {program, configDir} = request

    if (!program) throw new Error('The manifest names no Claude program.')

    const current: Session = {
      inbox: createInbox<Input>(),
      abort: new AbortController(),
    }

    const {signal} = current.abort

    function wasCanceled() {
      return signal.aborted
    }

    session = current

    try {
      yield {type: 'SIGN_IN_STEP', step: 'get-ready'}

      try {
        for await (const progress of deps.getProgramReady(program, {signal})) {
          yield {type: 'SIGN_IN_STEP', step: 'get-ready', progress}
        }
      } catch (error) {
        if (wasCanceled()) {
          yield canceled

          return
        }

        yield failed(
          'download-failed',
          error instanceof Error ? error.message : String(error)
        )

        return
      }

      if (wasCanceled()) {
        yield canceled

        return
      }

      const env = claudeEnvironment(deps.env, configDir)
      const command = deps.commandFor(program.path)
      const ended = yield* signInOnPage(current, command, env)

      if (ended) {
        yield ended

        return
      }

      yield {type: 'SIGN_IN_STEP', step: 'check-plan'}

      const account = await deps.readAccount({
        program: program.path,
        env,
        cwd: configDir,
      })

      const plan = planOf(account.subscriptionType)

      if (!plan) {
        await deps.signOut(command, env)
        yield failed('free-plan', 'This Claude account has no Pro or Max plan.')

        return
      }

      // Canceled while the plan was read, which is never cut short.
      if (wasCanceled()) {
        yield canceled

        return
      }

      yield {
        type: 'SIGN_IN_FINISHED',
        outcome: 'connected',
        account: {email: account.email ?? '', plan},
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
      session?.abort.abort()
      session?.inbox.push({kind: 'cancel'})
    },
  }
}
