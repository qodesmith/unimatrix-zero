/**
 * Calls `close` once a warm vendor program has sat idle long enough. What it
 * returns calls that off, for a Reply that claims the program first.
 */
export type WhenIdle = (close: () => void) => () => void

export function idleFor(ms: number): WhenIdle {
  return close => {
    const timer = setTimeout(close, ms)

    return () => clearTimeout(timer)
  }
}
