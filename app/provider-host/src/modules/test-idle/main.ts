import type {WhenIdle} from '#modules/idle/main'

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

    pass() {
      const due = [...waiting]
      waiting.clear()

      for (const wait of due) wait.close()
    },
  }
}
