import {useSyncExternalStore} from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onStoreChange: () => void) {
  const mql = globalThis.matchMedia(MOBILE_QUERY)
  mql.addEventListener('change', onStoreChange)
  return () => mql.removeEventListener('change', onStoreChange)
}

function getSnapshot() {
  return globalThis.matchMedia(MOBILE_QUERY).matches
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
