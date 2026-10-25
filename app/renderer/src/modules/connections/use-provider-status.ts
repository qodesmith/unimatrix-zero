import type {ProviderId, ProviderStatus} from '@uz/contract/providers'

import {bridge} from '#modules/bridge/main'
import {useEffect, useState} from 'react'

import {NOT_LOADED, applyConnectionEvent} from './cards'

/**
 * Where one Provider stands, as main reports it; null until main's SNAPSHOT
 * has named it.
 */
export function useProviderStatus(
  provider: ProviderId
): ProviderStatus['status'] | null {
  const [state, setState] = useState(NOT_LOADED)

  useEffect(
    () =>
      bridge().subscribe(event => {
        setState(current => applyConnectionEvent(current, event))
      }),
    []
  )

  if (!state.loaded) return null

  return (
    state.statuses.find(status => status.provider === provider)?.status ?? null
  )
}
