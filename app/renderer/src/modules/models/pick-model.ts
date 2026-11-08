import type {
  Model,
  ModelChoice,
  ProviderId,
  ProviderStatus,
} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'

/**
 * The Model an Input wants: `entry` is the listed entry the user picked it by,
 * null when it came from a Reply.
 */
export type WantedModel = ModelChoice & {entry: string | null}

export interface ModelPickInput {
  wanted: WantedModel | null
  /** The Provider of the Reply a continuing Thread's Input is attached to. */
  lockedTo: ProviderId | null
  statuses: ProviderStatus[]
  models: Record<ProviderId, Model[]>
}

interface ModelGroup {
  provider: ProviderId
  models: Model[]
}

type SelectedModel = WantedModel & {name: string}

export interface ModelPick {
  groups: ModelGroup[]
  /** `model` is the concrete id to send, whatever entry names it. */
  selected: SelectedModel | null
  notice: string | null
  signInAgain: ProviderId | null
  heldBecause: string | null
}

const LOADING = 'Loading Models…'

/** The Model an entry names now: an alias's or the default's, or its own id. */
function concreteOf(model: Model) {
  return model.resolvesTo ?? model.id
}

/** Resolved now, so a later move of the alias or default leaves it be. */
export function pickedFrom(provider: ProviderId, model: Model): WantedModel {
  return {provider, model: concreteOf(model), entry: model.id}
}

/**
 * A Reply records the id it was written on, which may be a `resolvesTo`; the
 * default resolves to another entry's Model too, which names it better.
 */
export function findModel(models: Model[], id: string) {
  const resolved = models.filter(model => model.resolvesTo === id)

  return (
    models.find(model => model.id === id) ??
    resolved.find(model => !model.isDefault) ??
    resolved[0] ??
    null
  )
}

function isConnected(status: ProviderStatus) {
  return status.account !== null && status.status !== 'signed-out'
}

function defaultOf(models: Model[]) {
  const usable = models.filter(model => !model.needsAppUpdate)

  return usable.find(model => model.isDefault) ?? usable[0] ?? null
}

function selectedOf(provider: ProviderId, model: Model): SelectedModel {
  return {...pickedFrom(provider, model), name: model.name}
}

type Selection = Pick<ModelPick, 'selected' | 'heldBecause'>

function startOn(
  provider: ProviderId,
  models: Record<ProviderId, Model[]>
): Selection {
  const listed = models[provider]

  if (listed.length === 0) return {selected: null, heldBecause: LOADING}

  const fallback = defaultOf(listed)

  return fallback
    ? {selected: selectedOf(provider, fallback), heldBecause: null}
    : {
        selected: null,
        heldBecause: `${PROVIDER_NAMES[provider]} offers no Model this app version can use`,
      }
}

function startOnFirstConnected({statuses, models}: ModelPickInput): Selection {
  const first = statuses.find(isConnected)

  return first
    ? startOn(first.provider, models)
    : {selected: null, heldBecause: 'Connect a Provider to send'}
}

/** The picked entry while it still names the Model picked on it. */
function entryOf(listed: Model[], wanted: WantedModel) {
  const picked = listed.find(
    model => model.id === wanted.entry && concreteOf(model) === wanted.model
  )

  return picked ?? findModel(listed, wanted.model)
}

function gone(notice: string) {
  return {selected: null, notice, heldBecause: 'Pick a Model to send'}
}

/** The wanted Model's Provider is connected; never sends on a fallback. */
function fromList(wanted: WantedModel, models: Record<ProviderId, Model[]>) {
  const listed = models[wanted.provider]

  if (listed.length === 0) {
    return {selected: null, notice: null, heldBecause: LOADING}
  }

  const found = entryOf(listed, wanted)

  if (!found) return gone(`${wanted.model} is no longer offered`)

  if (found.needsAppUpdate) return gone(`${found.name} needs an app update`)

  return {
    selected: selectedOf(wanted.provider, found),
    notice: null,
    heldBecause: null,
  }
}

function fromWanted(
  wanted: WantedModel,
  input: ModelPickInput
): Omit<ModelPick, 'groups' | 'signInAgain'> {
  const status = input.statuses.find(one => one.provider === wanted.provider)
  const name = PROVIDER_NAMES[wanted.provider]

  if (status?.status === 'signed-out') {
    const found = findModel(input.models[wanted.provider], wanted.model)

    return {
      selected: {
        ...wanted,
        name: found?.name ?? wanted.model,
        entry: found?.id ?? null,
      },
      notice: null,
      heldBecause: `Sign in to ${name} again to send`,
    }
  }

  if (status && isConnected(status)) return fromList(wanted, input.models)

  if (input.lockedTo !== null) {
    return {
      selected: null,
      notice: null,
      heldBecause: `Connect ${name} to continue this Thread`,
    }
  }

  const started = startOnFirstConnected(input)
  const notice = `${name} isn’t connected`

  return {
    ...started,
    notice: started.selected
      ? `${notice} · using ${started.selected.name}`
      : notice,
  }
}

/** What an Input's Model picker offers and shows, and whether it may send. */
export function pickModel(input: ModelPickInput): ModelPick {
  const {wanted, lockedTo, statuses, models} = input

  const groups = statuses
    .filter(
      status =>
        status.account !== null &&
        (lockedTo === null || status.provider === lockedTo)
    )
    .map(({provider}) => ({provider, models: models[provider]}))
    .filter(group => group.models.length > 0)

  if (wanted === null) {
    return {
      groups,
      ...startOnFirstConnected(input),
      notice: null,
      signInAgain: null,
    }
  }

  const status = statuses.find(one => one.provider === wanted.provider)

  return {
    groups,
    ...fromWanted(wanted, input),
    signInAgain: status?.status === 'signed-out' ? wanted.provider : null,
  }
}
