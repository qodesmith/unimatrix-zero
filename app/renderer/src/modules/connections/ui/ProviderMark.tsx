import type {ProviderId} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'
import {cn} from 'cn'

import {ABOUT} from '../about'

/** The Provider's icon, named for screen readers. */
export function ProviderMark({
  provider,
  className,
}: {
  provider: ProviderId
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={PROVIDER_NAMES[provider]}
      className={cn('leading-none', className)}
    >
      {ABOUT[provider].mark}
    </span>
  )
}
