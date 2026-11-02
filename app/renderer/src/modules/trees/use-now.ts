import {useSyncExternalStore} from 'react'

// Finer than the minutes a relative time shows, so none lags by a whole one.
const TICK_MS = 15_000

let now = Date.now()
let timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()

function tick() {
  now = Date.now()

  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)

  if (listeners.size === 1) {
    now = Date.now()
    timer = setInterval(tick, TICK_MS)
  }

  return () => {
    listeners.delete(listener)

    if (listeners.size === 0) clearInterval(timer)
  }
}

function getSnapshot() {
  return now
}

/** The time, in ms, moving on every few seconds while anything reads it. */
export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
