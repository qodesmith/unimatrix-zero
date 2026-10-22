import type {HostCommand} from '@uz/contract/host'
import type {Model, ProviderId} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {HostMessageSchema} from '@uz/contract/host'

/** One running Provider host, as main drives it. */
export interface HostProcess {
  post(command: HostCommand): void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the process boundary: HostMessageSchema parses it
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: () => void): void
  kill(): void
}

/** Waits before each restart after a crash; after the last, the host stays down. */
export const RESTART_DELAYS_MS = [1000, 5000, 30_000]

/** A host that stays up this long after reporting ready has recovered. */
export const STABLE_AFTER_MS = 60_000

interface Host {
  process: HostProcess | null
  /** Set once the host reports ready. */
  models: Model[] | null
  restarts: number
  timers: Set<ReturnType<typeof setTimeout>>
}

interface ProviderHostsOptions {
  spawn: (provider: ProviderId) => HostProcess
  onReplyEvent: (provider: ProviderId, event: ReplyEvent) => void
  /** The host died without main asking it to. */
  onCrash: (provider: ProviderId) => void
}

export type ProviderHosts = ReturnType<typeof createProviderHosts>

/**
 * One utility process per connected Provider. A host that crashes is
 * restarted after 1 s, 5 s, then 30 s; one that then stays up a minute starts
 * the count over.
 */
export function createProviderHosts({
  spawn,
  onReplyEvent,
  onCrash,
}: ProviderHostsOptions) {
  const hosts = new Map<ProviderId, Host>()

  function later(host: Host, ms: number, run: () => void) {
    const timer = setTimeout(() => {
      host.timers.delete(timer)
      run()
    }, ms)

    host.timers.add(timer)
  }

  function clearTimers(host: Host) {
    for (const timer of host.timers) clearTimeout(timer)
    host.timers.clear()
  }

  function start(provider: ProviderId, host: Host) {
    const child = spawn(provider)
    host.process = child
    host.models = null

    child.onMessage(raw => {
      const parsed = HostMessageSchema.safeParse(raw)

      if (!parsed.success || host.process !== child) return

      const message = parsed.data

      if (message.type === 'HOST_READY') {
        host.models = message.models
        later(host, STABLE_AFTER_MS, () => {
          host.restarts = 0
        })
      } else {
        onReplyEvent(provider, message)
      }
    })

    child.onExit(() => {
      if (host.process !== child) return

      host.process = null
      host.models = null
      clearTimers(host)
      onCrash(provider)

      const delay = RESTART_DELAYS_MS[host.restarts]

      if (delay === undefined) return

      host.restarts += 1
      later(host, delay, () => start(provider, host))
    })
  }

  return {
    /** Starts the Provider's host, unless it is already running. */
    connect(provider: ProviderId) {
      if (hosts.has(provider)) return

      const host: Host = {
        process: null,
        models: null,
        restarts: 0,
        timers: new Set(),
      }

      hosts.set(provider, host)
      start(provider, host)
    },

    /** The first Provider whose host is ready, with its default Model. */
    ready(): {provider: ProviderId; model: Model} | null {
      for (const [provider, host] of hosts) {
        const model = host.models?.[0]

        if (host.process && model) return {provider, model}
      }

      return null
    },

    send(provider: ProviderId, command: HostCommand) {
      const child = hosts.get(provider)?.process

      if (!child) throw new Error(`The ${provider} host is not running.`)

      child.post(command)
    },

    /** Stops every host on purpose, so none of them counts as a crash. */
    stopAll() {
      for (const host of hosts.values()) {
        clearTimers(host)
        const child = host.process
        host.process = null
        child?.kill()
      }

      hosts.clear()
    },
  }
}
