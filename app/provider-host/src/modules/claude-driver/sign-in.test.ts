import type {ClaudeSignInDeps} from './sign-in'
import type {AccountInfo} from '@anthropic-ai/claude-agent-sdk'
import type {SignInUpdate} from '@uz/contract/providers'

import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {FAKE_CODE, FAKE_CODE_PAGE, FAKE_STATE, fakeClaude} from './fake-claude'
import {startLogin} from './login'
import {createClaudeSignIn} from './sign-in'

const request = {
  program: {
    path: '/data/vendor/claude/2.1.307/claude',
    build: {
      url: 'https://downloads.claude.ai/claude-code-releases/2.1.307/darwin-arm64/claude',
      sha256: 'a'.repeat(64),
      size: 1000,
    },
  },
  configDir: '/data/providers/claude',
}

const maxAccount: AccountInfo = {
  email: 'sam@example.com',
  subscriptionType: 'max',
}

let claude: Awaited<ReturnType<typeof fakeClaude>>

beforeEach(async () => {
  claude = await fakeClaude()
})

afterEach(async () => {
  await claude.cleanUp()
})

/**
 * Deps whose `claude auth login` is the fake; the rest succeed unless
 * overridden.
 */
function deps(overrides: Partial<ClaudeSignInDeps> = {}) {
  return {
    async *getProgramReady() {
      yield {receivedBytes: 1000, totalBytes: 1000}
    },
    commandFor: () => claude,
    startLogin: vi.fn<ClaudeSignInDeps['startLogin']>(startLogin),
    readAccount: vi.fn<ClaudeSignInDeps['readAccount']>(async () => maxAccount),
    signOut: vi.fn<ClaudeSignInDeps['signOut']>(async () => undefined),
    env: {...process.env, ANTHROPIC_API_KEY: 'sk-ant-api'},
    timeoutMs: 10_000,
    ...overrides,
  } satisfies ClaudeSignInDeps
}

type SignIn = ReturnType<typeof createClaudeSignIn>

/** Connects, letting `react` act on each update as the user would. */
async function connect(
  signIn: SignIn,
  react: (update: SignInUpdate) => void = () => undefined
) {
  const updates: SignInUpdate[] = []

  for await (const update of signIn.signIn(request)) {
    updates.push(update)
    react(update)
  }

  return updates
}

function isStep(update: SignInUpdate, step: string) {
  return update.type === 'SIGN_IN_STEP' && update.step === step
}

it('downloads, signs in on Claude’s page and reads the plan', async () => {
  const used = deps({env: {...deps().env, FAKE_SIGN_IN_ANSWERS: 'yes'}})

  const updates = await connect(createClaudeSignIn(used))

  expect(updates).toEqual([
    {type: 'SIGN_IN_STEP', step: 'get-ready'},
    {
      type: 'SIGN_IN_STEP',
      step: 'get-ready',
      progress: {receivedBytes: 1000, totalBytes: 1000},
    },
    {type: 'SIGN_IN_STEP', step: 'sign-in-page', url: FAKE_CODE_PAGE},
    {type: 'SIGN_IN_STEP', step: 'check-plan'},
    {
      type: 'SIGN_IN_FINISHED',
      outcome: 'connected',
      account: {email: 'sam@example.com', plan: 'Max'},
    },
  ])
})

it('runs claude in its own folder, with no key that outranks the subscription', async () => {
  const login = vi.fn<ClaudeSignInDeps['startLogin']>(startLogin)
  const account = vi.fn<ClaudeSignInDeps['readAccount']>(async () => maxAccount)

  await connect(
    createClaudeSignIn(
      deps({
        env: {...deps().env, FAKE_SIGN_IN_ANSWERS: 'yes'},
        startLogin: login,
        readAccount: account,
      })
    )
  )

  const [, loginEnv] = login.mock.calls[0] ?? []
  const [session] = account.mock.calls[0] ?? []

  for (const env of [loginEnv, session?.env]) {
    expect(env).toMatchObject({
      CLAUDE_CONFIG_DIR: '/data/providers/claude',
      DISABLE_UPDATES: '1',
    })
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY')
  }

  expect(session).toMatchObject({
    program: request.program.path,
    cwd: '/data/providers/claude',
  })
})

it('takes the code from the page opened again', async () => {
  const signIn = createClaudeSignIn(deps())

  const updates = await connect(signIn, update => {
    if (isStep(update, 'sign-in-page')) signIn.signInPageOpened()

    if (isStep(update, 'paste-code')) signIn.submitSignInCode(` ${FAKE_CODE}\n`)
  })

  expect(updates.filter(update => isStep(update, 'paste-code'))).toEqual([
    {type: 'SIGN_IN_STEP', step: 'paste-code', url: FAKE_CODE_PAGE},
  ])
  expect(updates.at(-1)).toMatchObject({outcome: 'connected'})
})

it('flags a code from another sign-in without sending it', async () => {
  const used = deps()
  const signIn = createClaudeSignIn(used)
  let pasted = 0

  const updates = await connect(signIn, update => {
    if (isStep(update, 'sign-in-page')) signIn.signInPageOpened()

    if (isStep(update, 'paste-code')) {
      pasted += 1
      signIn.submitSignInCode(pasted === 1 ? 'the-code#other-state' : FAKE_CODE)
    }
  })

  expect(updates.filter(update => isStep(update, 'paste-code'))).toEqual([
    {type: 'SIGN_IN_STEP', step: 'paste-code', url: FAKE_CODE_PAGE},
    {
      type: 'SIGN_IN_STEP',
      step: 'paste-code',
      url: FAKE_CODE_PAGE,
      wrongCode: true,
    },
  ])
  expect(used.startLogin).toHaveBeenCalledTimes(1)
  expect(updates.at(-1)).toMatchObject({outcome: 'connected'})
})

it('starts a new sign-in when Claude refuses the code', async () => {
  const used = deps()
  const signIn = createClaudeSignIn(used)
  let pasted = 0

  const updates = await connect(signIn, update => {
    if (isStep(update, 'sign-in-page')) signIn.signInPageOpened()

    if (isStep(update, 'paste-code')) {
      pasted += 1
      signIn.submitSignInCode(
        pasted === 1 ? `expired#${FAKE_STATE}` : FAKE_CODE
      )
    }
  })

  expect(used.startLogin).toHaveBeenCalledTimes(2)
  expect(updates.findLast(update => isStep(update, 'paste-code'))).toEqual({
    type: 'SIGN_IN_STEP',
    step: 'paste-code',
    url: FAKE_CODE_PAGE,
    wrongCode: true,
  })
  expect(updates.at(-1)).toMatchObject({outcome: 'connected'})
})

it('fails with one plain reason when the download fails', async () => {
  const used = deps({
    // oxlint-disable-next-line require-yield -- offline before the first byte
    async *getProgramReady() {
      throw new TypeError('fetch failed')
    },
  })

  const updates = await connect(createClaudeSignIn(used))

  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'download-failed', message: 'fetch failed'},
  })
  expect(used.startLogin).not.toHaveBeenCalled()
})

it('cancels the download', async () => {
  const signIn = createClaudeSignIn(
    deps({
      async *getProgramReady(_target, {signal}) {
        yield {receivedBytes: 0, totalBytes: 1000}

        if (!signal.aborted) {
          await new Promise(resolve => {
            signal.addEventListener('abort', resolve)
          })
        }

        signal.throwIfAborted()
      },
    })
  )

  const updates = await connect(signIn, update => {
    if (update.type === 'SIGN_IN_STEP' && update.progress) signIn.cancelSignIn()
  })

  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
})

it('cancels on the sign-in page, ending claude auth login', async () => {
  const signIn = createClaudeSignIn(deps())

  const updates = await connect(signIn, update => {
    if (isStep(update, 'sign-in-page')) signIn.cancelSignIn()
  })

  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
})

it('fails when Claude’s page is declined', async () => {
  const used = deps({env: {...deps().env, FAKE_SIGN_IN_ANSWERS: 'no'}})

  const updates = await connect(createClaudeSignIn(used))

  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'no-answer', message: 'Login failed: access_denied'},
  })
})

it('gives up when Claude’s page never answers', async () => {
  const updates = await connect(createClaudeSignIn(deps({timeoutMs: 50})))

  expect(updates.at(-1)).toMatchObject({
    outcome: 'failed',
    failure: {reason: 'no-answer'},
  })
})

it('signs a free account out again and refuses it', async () => {
  const used = deps({
    env: {...deps().env, FAKE_SIGN_IN_ANSWERS: 'yes'},
    readAccount: vi.fn<ClaudeSignInDeps['readAccount']>(async () => ({
      email: 'sam@example.com',
    })),
  })

  const updates = await connect(createClaudeSignIn(used))

  expect(used.signOut).toHaveBeenCalledOnce()
  expect(updates.at(-1)).toMatchObject({
    outcome: 'failed',
    failure: {reason: 'free-plan'},
  })
})
