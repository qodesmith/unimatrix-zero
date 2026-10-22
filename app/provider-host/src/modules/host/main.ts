import type {
  HostCommand,
  HostMessage,
  ProviderDriver,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {createClaudeDriver} from '#modules/claude-driver/main'
import {createFakeDriver} from '#modules/fake-driver/main'
import {HostCommandSchema} from '@uz/contract/host'

/** The host's side of its link to main: Electron's `process.parentPort`. */
export interface HostPort {
  postMessage(message: HostMessage): void
  on(event: 'message', listener: (event: {data: unknown}) => void): void
}

/**
 * Runs one driver behind the port: tells main it is ready with the driver's
 * Models, then streams each requested Reply, and each step of connecting,
 * back as it happens. Commands that don't parse are dropped.
 */
export async function runHost(port: HostPort, driver: ProviderDriver) {
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
      port.postMessage({
        type: 'SIGN_IN_FINISHED',
        outcome: 'failed',
        failure: {
          reason: 'failed',
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }

  function run(command: HostCommand) {
    switch (command.type) {
      case 'reply.start':
        void stream(command.request)
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
    }
  }

  port.on('message', ({data}) => {
    const command = HostCommandSchema.safeParse(data)

    if (command.success) run(command.data)
  })

  port.postMessage({type: 'HOST_READY', models: await driver.listModels()})
}

function driverFor(provider: ProviderId): ProviderDriver {
  if (process.argv.includes('--fake')) return createFakeDriver()

  if (provider === 'claude') return createClaudeDriver()

  throw new Error(`There is no ${provider} driver yet; start with --fake.`)
}

export function startHost(provider: ProviderId) {
  void runHost(process.parentPort, driverFor(provider))
}
