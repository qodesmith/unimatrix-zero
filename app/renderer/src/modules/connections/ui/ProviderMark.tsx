import type {ProviderId} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'

import {ABOUT} from '../about'

export function ProviderMark({provider}: {provider: ProviderId}) {
  return (
    <span
      role="img"
      aria-label={PROVIDER_NAMES[provider]}
      className="leading-none"
    >
      {ABOUT[provider].mark}
    </span>
  )
}
