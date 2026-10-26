import type {Database} from '#modules/database/main'
import type {HostStatus, ProviderHosts} from '#modules/provider-hosts/main'
import type {AppEvent} from '@uz/contract/events'
import type {SignInRequest} from '@uz/contract/host'
import type {
  Account,
  ProviderId,
  ProviderStatus,
  SignInFinished,
  SignInStep,
  SignInUpdate,
} from '@uz/contract/providers'

import {schema} from '#modules/database/main'
import {
  PROVIDER_NAMES,
  ProviderIdSchema,
  signInFailed,
} from '@uz/contract/providers'
import {eq} from 'drizzle-orm'

interface ConnectionsOptions {
  db: Database
  hosts: Pick<ProviderHosts, 'connect' | 'send' | 'stop'>
  publish: (event: AppEvent) => void
  /** Null when the Provider can't be connected here. */
  requestFor: (provider: ProviderId) => SignInRequest | null
  openExternal: (url: string) => void
  now: () => Date
}

export type Connections = ReturnType<typeof createConnections>

/**
 * Main keeps the latest sign-in step for windows that connect mid-way. A host
 * started only to connect is stopped if connecting doesn't finish.
 */
export function createConnections({
  db,
  hosts,
  publish,
  requestFor,
  openExternal,
  now,
}: ConnectionsOptions) {
  const {providers} = schema
  const hostStatuses = new Map<ProviderId, HostStatus>()
  let signIn: SignInStep | null = null

  function accountOf(provider: ProviderId): Account | null {
    const row = db
      .select({email: providers.email, plan: providers.plan})
      .from(providers)
      .where(eq(providers.provider, provider))
      .get()

    return row ?? null
  }

  function statusOf(provider: ProviderId): ProviderStatus {
    const account = accountOf(provider)

    return {
      provider,
      status: account
        ? (hostStatuses.get(provider) ?? 'starting')
        : 'not-connected',
      account,
    }
  }

  function publishStatus(provider: ProviderId) {
    publish({type: 'PROVIDER_STATUS', ...statusOf(provider)})
  }

  function save(provider: ProviderId, account: Account) {
    db.insert(providers)
      .values({provider, ...account, connectedAt: now()})
      .onConflictDoUpdate({
        target: providers.provider,
        set: {...account, connectedAt: now()},
      })
      .run()
  }

  function finish(provider: ProviderId, update: SignInFinished) {
    signIn = null

    if (update.outcome === 'connected') {
      save(provider, update.account)
    } else if (!accountOf(provider)) {
      hosts.stop(provider)
      hostStatuses.delete(provider)
    }

    publish({...update, provider})

    if (update.outcome === 'connected') publishStatus(provider)
  }

  function connecting(provider: ProviderId) {
    if (signIn?.provider !== provider) {
      throw new Error(`${PROVIDER_NAMES[provider]} isn’t being connected.`)
    }

    return signIn
  }

  return {
    snapshot() {
      return {providers: ProviderIdSchema.options.map(statusOf), signIn}
    },

    startConnected() {
      for (const {provider} of db
        .select({provider: providers.provider})
        .from(providers)
        .all()) {
        hosts.connect(provider)
      }
    },

    connect(provider: ProviderId) {
      const name = PROVIDER_NAMES[provider]

      if (signIn) {
        throw new Error(
          `You can connect ${name} once ${PROVIDER_NAMES[signIn.provider]} is done.`
        )
      }

      if (accountOf(provider)) throw new Error(`${name} is already connected.`)

      const request = requestFor(provider)

      if (!request) {
        throw new Error(`${name} can’t be connected in this version yet.`)
      }

      hosts.connect(provider)
      hosts.send(provider, {type: 'sign-in.start', request})
      signIn = {type: 'SIGN_IN_STEP', provider, step: 'get-ready'}
      publish(signIn)
    },

    openPage(provider: ProviderId) {
      const {url} = connecting(provider)

      if (!url) throw new Error('The sign-in page isn’t ready yet.')

      openExternal(url)
      hosts.send(provider, {type: 'sign-in.page-opened'})
    },

    submitCode(provider: ProviderId, code: string) {
      connecting(provider)
      hosts.send(provider, {type: 'sign-in.code', code})
    },

    cancel(provider: ProviderId) {
      connecting(provider)
      hosts.send(provider, {type: 'sign-in.cancel'})
    },

    applySignInUpdate(provider: ProviderId, update: SignInUpdate) {
      if (signIn?.provider !== provider) return

      if (update.type === 'SIGN_IN_FINISHED') {
        finish(provider, update)

        return
      }

      const {openPage, ...step} = update

      if (openPage && step.url) openExternal(step.url)

      signIn = {...step, provider}
      publish(signIn)
    },

    applyHostStatus(provider: ProviderId, status: HostStatus) {
      hostStatuses.set(provider, status)

      if (accountOf(provider)) publishStatus(provider)
    },

    hostCrashed(provider: ProviderId) {
      if (signIn?.provider !== provider) return

      finish(
        provider,
        signInFailed(
          'failed',
          `${PROVIDER_NAMES[provider]} stopped unexpectedly.`
        )
      )
    },
  }
}
