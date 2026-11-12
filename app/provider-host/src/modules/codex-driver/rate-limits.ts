import type {RateLimits} from './wire'

/** When all full windows lift, in seconds since the epoch; else undefined. */
export function limitLifts({primary, secondary}: RateLimits) {
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
