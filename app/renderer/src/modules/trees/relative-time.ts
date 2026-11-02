const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
const MONTH = 30 * DAY
const YEAR = 365 * DAY

const units = [
  [YEAR, 'y'],
  [MONTH, 'mo'],
  [WEEK, 'w'],
  [DAY, 'd'],
  [HOUR, 'h'],
  [MINUTE, 'm'],
] as const

/** How long ago `at` was, in the sidebar's short form: "now", "5m", "3h", "2d". */
export function relativeTime(at: string, now: number) {
  const elapsed = now - Date.parse(at)
  const unit = units.find(([length]) => elapsed >= length)

  return unit ? `${Math.floor(elapsed / unit[0])}${unit[1]}` : 'now'
}
