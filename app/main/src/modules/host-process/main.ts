import type {HostProcess} from '#modules/provider-hosts/main'
import type {ProviderId} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'
import {utilityProcess} from 'electron'
import path from 'node:path'

/**
 * A crash shows up as the process's own `exit`, which Electron emits beside
 * `child-process-gone` and which names this exact process.
 */
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
