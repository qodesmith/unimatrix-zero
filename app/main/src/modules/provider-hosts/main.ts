import type {HostEvent, HostState} from './host-lifecycle/machine'
import type {HostProcess} from './host-process'
import type {
  HostCommand,
  OneShotFinished,
  OneShotRequest,
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
  SessionCutReport,
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
import {randomUUID} from 'node:crypto'

import {childOf, hostTransition, startingHost} from './host-lifecycle/machine'

export type {HostProcess} from './host-process'

export {RESTART_DELAYS_MS} from './host-lifecycle/machine'

/** A host that stays up this long after reporting ready has recovered. */
export const STABLE_AFTER_MS = 60_000

export const ONE_SHOT_TIMEOUT_MS = 60_000

interface PendingOneShot {
  resolve: (text: string) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface Host {
  state: HostState
  timers: Set<ReturnType<typeof setTimeout>>
  oneShots: Map<string, PendingOneShot>
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
  onSessionCut: (provider: ProviderId, cut: SessionCutReport) => void
  onReplyRecorded: (provider: ProviderId, recorded: ReplyRecorded) => void
  onSignInUpdate: (provider: ProviderId, update: SignInUpdate) => void
  onModels: (provider: ProviderId, models: Model[]) => void
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
  onModels,
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

  function settleOneShot(host: Host, {requestId, outcome}: OneShotFinished) {
    const pending = host.oneShots.get(requestId)

    if (!pending) return

    host.oneShots.delete(requestId)
    clearTimeout(pending.timer)

    if (outcome.ok) pending.resolve(outcome.text)
    else pending.reject(new Error(outcome.message))
  }

  function failOneShots(host: Host, message: string) {
    for (const pending of host.oneShots.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
    }

    host.oneShots.clear()
  }

  function send(host: Host, event: HostEvent) {
    const before = host.state
    host.state = hostTransition(before, event)

    return host.state !== before
  }

  function watch(provider: ProviderId, host: Host, child: HostProcess) {
    onStatus(provider, 'starting')

    child.onMessage(raw => {
      const parsed = HostMessageSchema.safeParse(raw)

      if (!parsed.success || childOf(host.state) !== child) return

      const message = parsed.data

      if (message.type === 'HOST_READY') {
        const {smallestModel} = message

        if (!send(host, {type: 'becameReady', smallestModel})) return

        later(host, STABLE_AFTER_MS, () => send(host, {type: 'stayedUp'}))
        onStatus(provider, 'ready')
      } else if (message.type === 'MODELS_CHANGED') {
        onModels(provider, message.models)
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
      } else if (message.type === 'ONE_SHOT_FINISHED') {
        settleOneShot(host, message)
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
      if (childOf(host.state) !== child) return

      send(host, {type: 'exited'})
      clearTimers(host)
      failOneShots(host, `The ${provider} host stopped unexpectedly.`)
      onCrash(provider)
      afterCrash(provider, host)
    })
  }

  function afterCrash(provider: ProviderId, host: Host) {
    const {state} = host

    switch (state.status) {
      case 'failed':
        onStatus(provider, 'failed')
        break
      case 'restarting':
        onStatus(provider, 'restarting')
        later(host, state.delayMs, () => {
          const child = spawn(provider)

          if (send(host, {type: 'spawned', child})) watch(provider, host, child)
        })
        break
      case 'starting':
      case 'ready':
        break
      // Main may have stopped the host while handling the crash.
      case 'stopped':
        break
      default:
        throw new Error('Unknown host state.')
    }
  }

  /** Stops the Provider's host on purpose, so it doesn't count as a crash. */
  function stop(provider: ProviderId) {
    const host = hosts.get(provider)

    if (!host) return

    hosts.delete(provider)
    clearTimers(host)
    failOneShots(host, `The ${provider} host was stopped.`)
    const child = childOf(host.state)
    send(host, {type: 'stopped'})
    child?.kill()
  }

  return {
    connect(provider: ProviderId) {
      if (hosts.has(provider)) return

      const child = spawn(provider)

      const host: Host = {
        state: startingHost(child),
        timers: new Set(),
        oneShots: new Map(),
      }

      hosts.set(provider, host)
      watch(provider, host, child)
    },

    ready(provider: ProviderId): boolean {
      return hosts.get(provider)?.state.status === 'ready'
    },

    send(provider: ProviderId, command: HostCommand) {
      const host = hosts.get(provider)
      const child = host ? childOf(host.state) : null

      if (!child) throw new Error(`The ${provider} host is not running.`)

      child.post(command)
    },

    /**
     * A tiny tool-free request outside any Tree, on the Provider's smallest
     * Model; rejects when the host can't run it, exits first or takes too long.
     */
    async runOneShot(
      provider: ProviderId,
      request: Omit<OneShotRequest, 'model'>
    ): Promise<string> {
      const host = hosts.get(provider)

      if (host?.state.status !== 'ready' || !host.state.smallestModel) {
        throw new Error(`The ${provider} host can’t run a one-shot.`)
      }

      const {child, smallestModel: model} = host.state

      const requestId = randomUUID()

      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          host.oneShots.delete(requestId)
          reject(new Error(`The ${provider} host took too long to answer.`))
          child.post({type: 'one-shot.cancel', requestId})
        }, ONE_SHOT_TIMEOUT_MS)

        host.oneShots.set(requestId, {resolve, reject, timer})
        child.post({
          type: 'one-shot.run',
          requestId,
          request: {...request, model},
        })
      })
    },

    stop,

    stopAll() {
      for (const provider of hosts.keys()) stop(provider)
    },
  }
}
