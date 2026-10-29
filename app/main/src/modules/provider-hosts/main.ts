import type {
  HostCommand,
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
  SessionCutDone,
  SessionStoreRequest,
  SessionStoreValue,
} from '@uz/contract/host'
import type {
  Model,
  ProviderId,
  ProviderStatus,
  SignInUpdate,
} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {HostMessageSchema} from '@uz/contract/host'

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

export type HostStatus = Extract<
  ProviderStatus['status'],
  'starting' | 'ready' | 'restarting' | 'failed'
>

interface ProviderHostsOptions {
  spawn: (provider: ProviderId) => HostProcess
  onReplyEvent: (provider: ProviderId, event: ReplyEvent) => void
  onPromptRecorded: (provider: ProviderId, recorded: PromptRecorded) => void
  onPromptDropped: (provider: ProviderId, dropped: PromptDropped) => void
  onSessionCut: (provider: ProviderId, cut: SessionCutDone) => void
  onReplyRecorded: (provider: ProviderId, recorded: ReplyRecorded) => void
  onSignInUpdate: (provider: ProviderId, update: SignInUpdate) => void
  /** Answers a host's request about its sessions; throws if it can't. */
  onSessionStore: (
    provider: ProviderId,
    request: SessionStoreRequest
  ) => SessionStoreValue
  onStatus: (provider: ProviderId, status: HostStatus) => void
  /** The host died without main asking it to. */
  onCrash: (provider: ProviderId) => void
}

export type ProviderHosts = ReturnType<typeof createProviderHosts>

/** One utility process per connected Provider, restarted after a crash. */
export function createProviderHosts({
  spawn,
  onReplyEvent,
  onPromptRecorded,
  onPromptDropped,
  onSessionCut,
  onReplyRecorded,
  onSignInUpdate,
  onSessionStore,
  onStatus,
  onCrash,
}: ProviderHostsOptions) {
  const hosts = new Map<ProviderId, Host>()

  function answer(provider: ProviderId, request: SessionStoreRequest) {
    try {
      return {ok: true as const, value: onSessionStore(provider, request)}
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

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
    onStatus(provider, 'starting')

    child.onMessage(raw => {
      const parsed = HostMessageSchema.safeParse(raw)

      if (!parsed.success || host.process !== child) return

      const message = parsed.data

      if (message.type === 'HOST_READY') {
        host.models = message.models
        later(host, STABLE_AFTER_MS, () => {
          host.restarts = 0
        })
        onStatus(provider, 'ready')
      } else if (
        message.type === 'SIGN_IN_STEP' ||
        message.type === 'SIGN_IN_FINISHED'
      ) {
        onSignInUpdate(provider, message)
      } else if (message.type === 'PROMPT_RECORDED') {
        onPromptRecorded(provider, message)
      } else if (message.type === 'PROMPT_DROPPED') {
        onPromptDropped(provider, message)
      } else if (message.type === 'SESSION_CUT') {
        onSessionCut(provider, message)
      } else if (message.type === 'REPLY_RECORDED') {
        onReplyRecorded(provider, message)
      } else if (message.type === 'SESSION_STORE') {
        child.post({
          type: 'session-store.result',
          requestId: message.requestId,
          outcome: answer(provider, message.request),
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

      // Main may have stopped it while handling the crash.
      if (hosts.get(provider) !== host) return

      const delay = RESTART_DELAYS_MS[host.restarts]

      if (delay === undefined) {
        onStatus(provider, 'failed')

        return
      }

      host.restarts += 1
      onStatus(provider, 'restarting')
      later(host, delay, () => start(provider, host))
    })
  }

  /** Stops the Provider's host on purpose, so it doesn't count as a crash. */
  function stop(provider: ProviderId) {
    const host = hosts.get(provider)

    if (!host) return

    hosts.delete(provider)
    clearTimers(host)
    const child = host.process
    host.process = null
    child?.kill()
  }

  return {
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

    /** A ready host's Provider (`only`, if given) and its default Model. */
    ready(only?: ProviderId): {provider: ProviderId; model: Model} | null {
      for (const [provider, host] of hosts) {
        const model = host.models?.[0]

        if (host.process && model && (only ?? provider) === provider) {
          return {provider, model}
        }
      }

      return null
    },

    send(provider: ProviderId, command: HostCommand) {
      const child = hosts.get(provider)?.process

      if (!child) throw new Error(`The ${provider} host is not running.`)

      child.post(command)
    },

    stop,

    stopAll() {
      for (const provider of hosts.keys()) stop(provider)
    },
  }
}
