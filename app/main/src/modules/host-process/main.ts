import type {HostProcess} from '#modules/provider-hosts/main'
import type {ProviderId} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'
import {utilityProcess} from 'electron'
import path from 'node:path'

/** A crash also fires the child's own `exit`, which names this exact process. */
export function utilityHost(hostsFolder: string, args: string[]) {
  return (provider: ProviderId): HostProcess => {
    const child = utilityProcess.fork(
      path.join(hostsFolder, `${provider}.mjs`),
      args,
      {serviceName: `${PROVIDER_NAMES[provider]} host`}
    )

    return {
      post: command => child.postMessage(command),
      onMessage: listener => {
        child.on('message', listener)
      },
      onExit: listener => {
        child.once('exit', listener)
      },
      kill: () => {
        child.kill()
      },
    }
  }
}
