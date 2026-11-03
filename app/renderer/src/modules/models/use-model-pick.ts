import type {ModelPick} from './pick-model'
import type {ModelChoice, ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {useConnections} from '#modules/connections/main'

import {findModel, pickModel} from './pick-model'

const NOT_LOADED: ModelPick = {
  groups: [],
  selected: null,
  notice: null,
  signInAgain: null,
  heldBecause: '',
}

/** Send is held with an empty reason until main's `SNAPSHOT` arrives. */
export function useModelPick(
  picked: ModelChoice | null,
  attachedTo: Reply | null
): ModelPick {
  const {state} = useConnections()

  if (!state.loaded) return NOT_LOADED

  const attached = attachedTo
    ? {provider: attachedTo.provider, model: attachedTo.model}
    : null

  return pickModel({
    wanted: picked ?? attached ?? state.lastModel,
    lockedTo: attachedTo?.provider ?? null,
    statuses: state.statuses,
    models: state.models,
  })
}

/** As the Provider lists it, else the id itself. */
export function useModelName(provider: ProviderId, id: string) {
  const {state} = useConnections()

  return findModel(state.models[provider], id)?.name ?? id
}
