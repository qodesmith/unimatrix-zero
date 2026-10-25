import type {ProviderId, ProviderStatus} from '@uz/contract/providers'

import {useSelector} from '@tanstack/react-store'

import {useConnectionsStore} from './use-connections'

/**
 * Where one Provider stands, as main reports it; null until main's SNAPSHOT
 * has named it.
 */
export function useProviderStatus(
  provider: ProviderId
): ProviderStatus['status'] | null {
  return useSelector(useConnectionsStore(), state =>
    state.loaded
      ? (state.statuses.find(status => status.provider === provider)?.status ??
        null)
      : null
  )
}
