import type {ModelPick, WantedModel} from './pick-model'
import type {ModelChoice, ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {useConnections} from '#modules/connections/main'
import {findModel} from '@uz/contract/providers'

import {pickModel} from './pick-model'

const NOT_LOADED: ModelPick = {
  groups: [],
  selected: null,
  notice: null,
  signInAgain: null,
  heldBecause: '',
}

function recordedOf({provider, model}: ModelChoice): WantedModel {
  return {provider, model, entry: null}
}

/** Send is held with an empty reason until main's `SNAPSHOT` arrives. */
export function useModelPick(
  picked: WantedModel | null,
  attachedTo: Reply | null
): ModelPick {
  const {state} = useConnections()

  if (!state.loaded) return NOT_LOADED

  const recorded = attachedTo ?? state.lastModel

  return pickModel({
    wanted: picked ?? (recorded && recordedOf(recorded)),
    lockedTo: attachedTo?.provider ?? null,
    statuses: state.statuses,
    models: state.models,
  })
}

export function useModelName(provider: ProviderId, id: string) {
  const {state} = useConnections()

  return findModel(state.models[provider], id)?.name ?? id
}
