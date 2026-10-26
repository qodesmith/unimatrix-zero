import type {WhenIdle} from '#modules/idle/main'

/** Idle time for tests: none passes until the test passes it. */
export function heldIdle() {
  const waiting = new Set<{close: () => void}>()

  function whenIdle(close: () => void) {
    const wait = {close}
    waiting.add(wait)

    return () => {
      waiting.delete(wait)
    }
  }

  return {
    whenIdle: whenIdle satisfies WhenIdle,

    /** Closes every program idle now. */
    pass() {
      const due = [...waiting]
      waiting.clear()

      for (const wait of due) wait.close()
    },
  }
}
