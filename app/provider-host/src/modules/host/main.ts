import type {HostMessage, ProviderDriver, ReplyRequest} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {createFakeDriver} from '#modules/fake-driver/main'
import {HostCommandSchema} from '@uz/contract/host'

/** The host's side of its link to main: Electron's `process.parentPort`. */
export interface HostPort {
  postMessage(message: HostMessage): void
  on(event: 'message', listener: (event: {data: unknown}) => void): void
}

/**
 * Runs one driver behind the port: tells main it is ready with the driver's
 * Models, then streams each requested Reply back event by event. Commands that
 * don't parse are dropped.
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

  port.on('message', ({data}) => {
    const command = HostCommandSchema.safeParse(data)

    if (command.success) void stream(command.data.request)
  })

  port.postMessage({type: 'HOST_READY', models: await driver.listModels()})
}

export function startHost(provider: ProviderId) {
  if (!process.argv.includes('--fake')) {
    throw new Error(`There is no ${provider} driver yet; start with --fake.`)
  }

  void runHost(process.parentPort, createFakeDriver())
}
