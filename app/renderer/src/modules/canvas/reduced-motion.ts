import {useSyncExternalStore} from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const media = globalThis.matchMedia(QUERY)
  media.addEventListener('change', onChange)

  return () => media.removeEventListener('change', onChange)
}

function reduced() {
  return globalThis.matchMedia(QUERY).matches
}

/** The OS asks for reduced motion: the canvas jumps where it would pan or zoom. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, reduced)
}
