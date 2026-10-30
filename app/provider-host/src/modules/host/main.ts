import type {SessionStoreClient} from '#modules/session-store/main'
import type {
  HostCommand,
  HostMessage,
  ProviderDriver,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {createClaudeDriver} from '#modules/claude-driver/main'
import {createCodexDriver} from '#modules/codex-driver/main'
import {createFakeDriver} from '#modules/fake-driver/main'
import {createSessionStoreClient} from '#modules/session-store/main'
import {HostCommandSchema} from '@uz/contract/host'
import {signInFailed} from '@uz/contract/providers'

/** The host's side of its link to main: Electron's `process.parentPort`. */
export interface HostPort {
  postMessage(message: HostMessage): void
  on(event: 'message', listener: (event: {data: unknown}) => void): void
}

/** Runs one driver behind the port; commands that don't parse are dropped. */
export async function runHost(
  port: HostPort,
  createDriver: (store: SessionStoreClient) => ProviderDriver
) {
  const store = createSessionStoreClient(message => port.postMessage(message))
  const driver = createDriver(store)

  async function stream(request: ReplyRequest) {
    const {treeId, replyId} = request

    try {
      for await (const event of driver.startReply(request)) {
        port.postMessage(event)
      }
    } catch (error) {
      port.postMessage({
        type: 'RUN_FINISHED',
        treeId,
        replyId,
        status: 'failed',
        failure: {
          code: 'driver-error',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  async function signIn(request: SignInRequest) {
    try {
      for await (const update of driver.signIn(request)) {
        port.postMessage(update)
      }
    } catch (error) {
      port.postMessage(
        signInFailed(
          'failed',
          error instanceof Error ? error.message : String(error)
        )
      )
    }
  }

  async function cut(command: Extract<HostCommand, {type: 'session.cut'}>) {
    const {treeId, replyId, session, vendorProgram} = command

    const made = await driver
      .cutSession({session, vendorProgram})
      .catch(() => false)

    if (made) {
      port.postMessage({
        type: 'SESSION_CUT',
        treeId,
        replyId,
        dropFrom: session.dropFrom,
      })
    }
  }

  function run(command: HostCommand) {
    switch (command.type) {
      case 'reply.start':
        void stream(command.request)
        break
      case 'reply.stop':
        void driver.stop(command.replyId).catch(() => undefined)
        break
      case 'session.cut':
        void cut(command)
        break
      case 'sign-in.start':
        void signIn(command.request)
        break
      case 'sign-in.page-opened':
        driver.signInPageOpened()
        break
      case 'sign-in.code':
        driver.submitSignInCode(command.code)
        break
      case 'sign-in.cancel':
        driver.cancelSignIn()
        break
      case 'session-store.result':
        store.settle(command.requestId, command.outcome)
        break
    }
  }

  port.on('message', ({data}) => {
    const command = HostCommandSchema.safeParse(data)

    if (command.success) run(command.data)
  })

  port.postMessage({type: 'HOST_READY', models: await driver.listModels()})
}

function driverFor(provider: ProviderId, store: SessionStoreClient) {
  if (process.argv.includes('--fake')) return createFakeDriver()

  return provider === 'claude'
    ? createClaudeDriver({store})
    : createCodexDriver({store})
}

export function startHost(provider: ProviderId) {
  void runHost(process.parentPort, store => driverFor(provider, store))
}
