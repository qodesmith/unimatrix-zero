import {useSyncExternalStore} from 'react'

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const media = globalThis.matchMedia(QUERY)
  media.addEventListener('change', onChange)

  return () => media.removeEventListener('change', onChange)
}

function mobile() {
  return globalThis.matchMedia(QUERY).matches
}

export function useIsMobile() {
  return useSyncExternalStore(subscribe, mobile)
}
