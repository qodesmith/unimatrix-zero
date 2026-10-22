import type {AppServer} from './app-server'
import type {Method, Notification, ParamsOf, ResponseOf} from './wire'
import type {SignInRequest} from '@uz/contract/host'
import type {SignInUpdate} from '@uz/contract/providers'

import {expect, it, vi} from 'vitest'

import {createCodexSignIn} from './sign-in'

const AUTH_URL = 'https://auth.openai.com/oauth/authorize?client_id=app_x'
const LOGIN_ID = 'login-1'

const request: SignInRequest = {
  program: {
    path: '/data/vendor/chatgpt/0.163.0',
    build: {
      url: 'https://github.com/openai/codex/releases/download/x.tar.gz',
      sha256: 'a'.repeat(64),
      size: 1,
      archive: {format: 'tar.gz', entrypoint: 'bin/codex-app-server'},
    },
  },
  configDir: '/data/providers/chatgpt',
}

/** Each method's answer; a method with none fails, as when `codex` stops. */
type Answers = {[M in Method]?: ResponseOf<M>}

/** An app-server that answers each request from `answers`. */
function fakeServer(answers: Answers) {
  const listeners = new Set<(notification: Notification) => void>()
  const requests: {method: Method; params: unknown}[] = []
  const {promise: exited, resolve: exit} = Promise.withResolvers<void>()
  let hasExited = false
  const close = vi.fn<() => Promise<void>>(async () => undefined)

  const server: AppServer = {
    async request<M extends Method>(method: M, params: ParamsOf<M>) {
      requests.push({method, params})

      const answer = answers[method]

      if (!answer) throw new Error('Codex stopped before it answered.')

      return answer as ResponseOf<M>
    },
    listen(listener) {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    exited,
    get hasExited() {
      return hasExited
    },
    close,
  }

  return {
    server,
    requests,
    close,
    notify(notification: Notification) {
      for (const listener of listeners) listener(notification)
    },
    exit() {
      hasExited = true
      exit()
    },
  }
}

const LOGIN = {
  type: 'chatgpt',
  loginId: LOGIN_ID,
  authUrl: AUTH_URL,
} satisfies ResponseOf<'account/login/start'>

const PLUS = {
  account: {type: 'chatgpt', email: 'sam@example.com', planType: 'plus'},
} satisfies ResponseOf<'account/read'>

function completed(success: boolean, error: string | null = null) {
  return {
    method: 'account/login/completed',
    params: {loginId: LOGIN_ID, success, error},
  } satisfies Notification
}

function setUp(
  answers: Answers = {'account/login/start': LOGIN, 'account/read': PLUS},
  options: {
    download?: () => AsyncIterable<never>
    portFree?: (port: number) => Promise<boolean>
    timeoutMs?: number
  } = {}
) {
  const fake = fakeServer(answers)

  const open = vi.fn<(request: SignInRequest) => Promise<AppServer>>(
    async () => fake.server
  )

  const signIn = createCodexSignIn({
    getProgramReady:
      options.download ??
      async function* () {
        yield {receivedBytes: 1, totalBytes: 1}
      },
    open,
    portFree: options.portFree ?? (async () => true),
    timeoutMs: options.timeoutMs ?? 60_000,
  })

  const updates: SignInUpdate[] = []

  async function run() {
    for await (const update of signIn.signIn(request)) updates.push(update)

    return updates
  }

  /** Waits until the sign-in page is up. */
  async function onPage() {
    await vi.waitFor(() => {
      expect(updates.at(-1)).toMatchObject({step: 'sign-in-page'})
    })
  }

  return {...fake, signIn, open, updates, run, onPage}
}

it('signs in on ChatGPT’s page and reads the account and plan', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.notify(completed(true))

  expect(await done).toEqual([
    {type: 'SIGN_IN_STEP', step: 'get-ready'},
    {
      type: 'SIGN_IN_STEP',
      step: 'get-ready',
      progress: {receivedBytes: 1, totalBytes: 1},
    },
    {
      type: 'SIGN_IN_STEP',
      step: 'sign-in-page',
      url: AUTH_URL,
      openPage: true,
    },
    {type: 'SIGN_IN_STEP', step: 'check-plan'},
    {
      type: 'SIGN_IN_FINISHED',
      outcome: 'connected',
      account: {email: 'sam@example.com', plan: 'Plus'},
    },
  ])
  expect(sign.open).toHaveBeenCalledWith(request)
  expect(sign.requests).toEqual([
    {method: 'account/login/start', params: {type: 'chatgpt'}},
    {method: 'account/read', params: {refreshToken: false}},
  ])
  expect(sign.close).toHaveBeenCalledOnce()
})

it('never asks for a code, even when the page is opened again', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.signIn.signInPageOpened()
  sign.signIn.submitSignInCode('a code')
  sign.notify(completed(true))

  const steps = await done

  expect(
    steps.filter(update => update.type === 'SIGN_IN_STEP').map(s => s.step)
  ).toEqual(['get-ready', 'get-ready', 'sign-in-page', 'check-plan'])
})

it('ignores a sign-in that finished for another login', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.notify({
    method: 'account/login/completed',
    params: {loginId: 'other', success: false, error: 'no'},
  })
  sign.notify(completed(true))

  expect((await done).at(-1)).toMatchObject({outcome: 'connected'})
})

it('connects a ChatGPT Free account, which can use Codex', async () => {
  const sign = setUp({
    'account/login/start': LOGIN,
    'account/read': {
      account: {type: 'chatgpt', email: null, planType: 'free'},
    },
  })

  const done = sign.run()
  await sign.onPage()
  sign.notify(completed(true))

  expect((await done).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account: {email: '', plan: 'Free'},
  })
})

it('shows the plan error when Codex refuses the account’s workspace', async () => {
  const refused =
    'Codex is not enabled for your workspace. Contact your workspace administrator to request access to Codex.'

  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.notify(completed(false, refused))

  expect((await done).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'plan-refused', message: refused},
  })
  expect(sign.close).toHaveBeenCalledOnce()
})

it('ends when the page declines the sign-in', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.notify(completed(false, 'access_denied'))

  expect((await done).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'no-answer', message: 'access_denied'},
  })
})

it('cancels the login when the user cancels', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.signIn.cancelSignIn()

  expect((await done).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
  expect(sign.requests.at(-1)).toEqual({
    method: 'account/login/cancel',
    params: {loginId: LOGIN_ID},
  })
  expect(sign.close).toHaveBeenCalledOnce()
})

it('gives up when the page never answers', async () => {
  const sign = setUp(undefined, {timeoutMs: 10})
  const steps = await sign.run()

  expect(steps.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'no-answer', message: 'ChatGPT’s page did not answer.'},
  })
  expect(sign.requests.at(-1)?.method).toBe('account/login/cancel')
})

it('fails when Codex stops before the page answers', async () => {
  const sign = setUp()
  const done = sign.run()
  await sign.onPage()
  sign.exit()

  expect((await done).at(-1)).toMatchObject({
    outcome: 'failed',
    failure: {reason: 'failed'},
  })
})

it.each<[string, ResponseOf<'account/read'> | undefined]>([
  ['no account', {account: null}],
  ['an API key', {account: {type: 'apiKey'}}],
  ['no answer', undefined],
])('fails when the plan read gives %s', async (_case, read) => {
  const sign = setUp({
    'account/login/start': LOGIN,
    ...(read ? {'account/read': read} : {}),
  })

  const done = sign.run()
  await sign.onPage()
  sign.notify(completed(true))

  expect((await done).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {
      reason: 'failed',
      message: 'Couldn’t check your ChatGPT plan. Try again.',
    },
  })
})

it('fails before starting Codex when the download fails', async () => {
  const sign = setUp(undefined, {
    // oxlint-disable-next-line require-yield -- a download that fails before its first byte
    async *download() {
      throw new Error('offline')
    },
  })

  expect((await sign.run()).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'download-failed', message: 'offline'},
  })
  expect(sign.open).not.toHaveBeenCalled()
})

it('doesn’t start a sign-in while another holds ChatGPT’s sign-in port', async () => {
  const portFree = vi.fn<(port: number) => Promise<boolean>>(async () => false)
  const sign = setUp(undefined, {portFree})

  expect((await sign.run()).at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {
      reason: 'failed',
      message:
        'Another ChatGPT or Codex sign-in is open. Finish or close it, then try again.',
    },
  })
  expect(portFree).toHaveBeenCalledWith(1455)
  expect(sign.open).not.toHaveBeenCalled()
  expect(sign.requests).toEqual([])
})
