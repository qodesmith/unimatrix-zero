import type {AppEvent} from '@uz/contract/events'
import type {
  Account,
  ProviderId,
  ProviderStatus,
  SignInFailure,
  SignInStep,
} from '@uz/contract/providers'

import {ProviderIdSchema} from '@uz/contract/providers'

/** What one Provider's card shows. */
export type Card =
  | {kind: 'idle'}
  | {kind: 'connecting'; step: SignInStep; pasting: boolean}
  | {kind: 'failed'; failure: SignInFailure}
  | {kind: 'connected'; account: Account}

export interface ConnectionsState {
  /** False until main's `SNAPSHOT` arrives. */
  loaded: boolean
  statuses: ProviderStatus[]
  signIn: SignInStep | null
  /** The connect reached a page with a code, so the card lists that step. */
  pasting: boolean
  failures: Partial<Record<ProviderId, SignInFailure>>
}

export const NOT_LOADED: ConnectionsState = {
  loaded: false,
  statuses: ProviderIdSchema.options.map(provider => ({
    provider,
    status: 'not-connected',
    account: null,
  })),
  signIn: null,
  pasting: false,
  failures: {},
}

function withoutFailure(state: ConnectionsState, provider: ProviderId) {
  return Object.fromEntries(
    Object.entries(state.failures).filter(([id]) => id !== provider)
  )
}

/** Shows a failure on the Provider's card until it connects again. */
export function withFailure(
  state: ConnectionsState,
  provider: ProviderId,
  failure: SignInFailure
): ConnectionsState {
  return {...state, failures: {...state.failures, [provider]: failure}}
}

/**
 * Folds main's events into the cards. A `SNAPSHOT` replaces everything; the
 * failures it can't know about are dropped with it.
 */
export function applyConnectionEvent(
  state: ConnectionsState,
  event: AppEvent
): ConnectionsState {
  if (event.type === 'SNAPSHOT') {
    return {
      loaded: true,
      statuses: event.providers,
      signIn: event.signIn,
      pasting: event.signIn?.step === 'paste-code',
      failures: {},
    }
  }

  if (event.type === 'PROVIDER_STATUS') {
    const {type: _type, ...status} = event

    return {
      ...state,
      statuses: state.statuses.map(current =>
        current.provider === status.provider ? status : current
      ),
    }
  }

  if (event.type === 'SIGN_IN_STEP') {
    return {
      ...state,
      signIn: event,
      pasting:
        event.step === 'paste-code' ||
        (state.pasting && state.signIn?.provider === event.provider),
      failures: withoutFailure(state, event.provider),
    }
  }

  if (event.type === 'SIGN_IN_FINISHED') {
    const finished = {...state, signIn: null, pasting: false}

    return event.outcome === 'failed'
      ? withFailure(finished, event.provider, event.failure)
      : finished
  }

  return state
}

export function cardOf(state: ConnectionsState, provider: ProviderId): Card {
  const account = state.statuses.find(
    status => status.provider === provider
  )?.account

  if (account) return {kind: 'connected', account}

  if (state.signIn?.provider === provider) {
    return {kind: 'connecting', step: state.signIn, pasting: state.pasting}
  }

  const failure = state.failures[provider]

  return failure ? {kind: 'failed', failure} : {kind: 'idle'}
}

export function anyConnected(state: ConnectionsState) {
  return state.statuses.some(status => status.account !== null)
}
