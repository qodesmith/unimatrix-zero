/** A CSS time, like `400ms` or `0.4s`, in ms; 0 when there's none to read. */
export function durationMs(time: string) {
  const value = Number.parseFloat(time)

  if (Number.isNaN(value)) return 0

  return time.trim().endsWith('ms') ? value : value * 1000
}

/**
 * The shared slide motion's length, `--transition-duration-slide` in
 * styles.css.
 */
export function slideMs() {
  return durationMs(
    getComputedStyle(document.documentElement).getPropertyValue(
      '--transition-duration-slide'
    )
  )
}
