import type {RateLimitReachedType} from './protocol/v2/RateLimitReachedType'
import type {RateLimits} from './wire'

/** A plain usage limit: credits and spend caps lift on no window's reset. */
const WINDOWED = 'rate_limit_reached' satisfies RateLimitReachedType

/** When all full windows lift, in seconds since the epoch; else undefined. */
export function limitLifts({
  primary,
  secondary,
  rateLimitReachedType,
}: RateLimits) {
  if ((rateLimitReachedType ?? WINDOWED) !== WINDOWED) {
    return undefined
  }

  const now = Date.now() / 1000

  const lifts = [primary, secondary].flatMap(window =>
    window !== null &&
    window.usedPercent >= 100 &&
    window.resetsAt !== null &&
    window.resetsAt > now
      ? [window.resetsAt]
      : []
  )

  return lifts.length === 0 ? undefined : Math.max(...lifts)
}
