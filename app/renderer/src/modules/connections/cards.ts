import type {AppEvent} from '@uz/contract/events'
import type {
  Account,
  Model,
  ModelChoice,
  ProviderId,
  ProviderStatus,
  SignInFailure,
  SignInStep,
} from '@uz/contract/providers'

import {ProviderIdSchema} from '@uz/contract/providers'

export type Card =
  | {kind: 'idle'}
  | {kind: 'connecting'; step: SignInStep; pasting: boolean}
  | {kind: 'failed'; failure: SignInFailure}
  | {kind: 'connected'; account: Account}

export interface ConnectionsState {
  loaded: boolean
  statuses: ProviderStatus[]
  signIn: SignInStep | null
  /**
   * The connect reached a page with a code, so the card lists that step.
   * False whenever no connect is under way, so a read needn't check `signIn`.
   */
  pasting: boolean
  failures: Partial<Record<ProviderId, SignInFailure>>
  models: Record<ProviderId, Model[]>
  lastModel: ModelChoice | null
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
  models: {claude: [], chatgpt: []},
  lastModel: null,
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

/** A `SNAPSHOT` replaces everything, dropping failures it can't know about. */
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
      models: event.models,
      lastModel: event.lastModel,
    }
  }

  if (event.type === 'MODELS_CHANGED') {
    return {...state, models: {...state.models, [event.provider]: event.models}}
  }

  if (event.type === 'LAST_MODEL_CHANGED') {
    return {...state, lastModel: event.model}
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

/** Only one Provider connects at a time: the one this one waits for. */
export function waitingFor(
  state: ConnectionsState,
  provider: ProviderId
): ProviderId | null {
  const connecting = state.signIn?.provider ?? null

  return connecting === provider ? null : connecting
}

export function anyConnected(state: ConnectionsState) {
  return state.statuses.some(status => status.account !== null)
}
