import type {
  Model,
  ModelChoice,
  ProviderId,
  ProviderStatus,
} from '@uz/contract/providers'

import {DEFAULT_MODEL_ID, PROVIDER_NAMES} from '@uz/contract/providers'

export interface ModelPickInput {
  /** The user's pick in this Input, else its Reply's Model, else the last-used. */
  wanted: ModelChoice | null
  /** The Provider of the Reply a continuing Thread's Input is attached to. */
  lockedTo: ProviderId | null
  statuses: ProviderStatus[]
  models: Record<ProviderId, Model[]>
}

interface ModelGroup {
  provider: ProviderId
  models: Model[]
}

type SelectedModel = ModelChoice & {name: string}

export interface ModelPick {
  groups: ModelGroup[]
  selected: SelectedModel | null
  /** Set whenever the selection differs from the wanted Model. */
  notice: string | null
  signInAgain: ProviderId | null
  heldBecause: string | null
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
  return {provider, model: model.id, name: model.name}
}

type Selection = Pick<ModelPick, 'selected' | 'heldBecause'>

/**
 * The Provider's default, or why there is none to send with. Before it lists
 * any, the choice is left to it.
 */
function startOn(
  provider: ProviderId,
  models: Record<ProviderId, Model[]>
): Selection {
  const listed = models[provider]

  if (listed.length === 0) {
    return {
      selected: {provider, model: DEFAULT_MODEL_ID, name: 'Default'},
      heldBecause: null,
    }
  }

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

function withNotice(gone: string, selection: Selection) {
  return {
    ...selection,
    notice: selection.selected
      ? `${gone} · using ${selection.selected.name}`
      : gone,
  }
}

/** The wanted Model's Provider is connected. */
function fromList(wanted: ModelChoice, models: Record<ProviderId, Model[]>) {
  const listed = models[wanted.provider]
  const found = findModel(listed, wanted.model)

  if (listed.length === 0) {
    return {selected: {...wanted, name: wanted.model}, heldBecause: null}
  }

  if (found && !found.needsAppUpdate) {
    return {selected: selectedOf(wanted.provider, found), heldBecause: null}
  }

  return withNotice(
    found
      ? `${found.name} needs an app update`
      : `${wanted.model} is no longer offered`,
    startOn(wanted.provider, models)
  )
}

function fromWanted(
  wanted: ModelChoice,
  input: ModelPickInput
): Omit<ModelPick, 'groups' | 'signInAgain'> {
  const status = input.statuses.find(one => one.provider === wanted.provider)
  const name = PROVIDER_NAMES[wanted.provider]

  if (status?.status === 'signed-out') {
    const found = findModel(input.models[wanted.provider], wanted.model)

    return {
      selected: {...wanted, name: found?.name ?? wanted.model},
      notice: null,
      heldBecause: `Sign in to ${name} again to send`,
    }
  }

  if (status && isConnected(status)) {
    return {notice: null, ...fromList(wanted, input.models)}
  }

  if (input.lockedTo !== null) {
    return {
      selected: null,
      notice: null,
      heldBecause: `Connect ${name} to continue this Thread`,
    }
  }

  return withNotice(`${name} isn’t connected`, startOnFirstConnected(input))
}

/**
 * What an Input's Model picker offers and shows, and whether it may send. The
 * selection never differs from the wanted Model without a notice saying so.
 */
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
