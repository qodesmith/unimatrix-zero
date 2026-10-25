import {useSyncExternalStore} from 'react'

function subscribe(onChange: () => void) {
  globalThis.addEventListener('online', onChange)
  globalThis.addEventListener('offline', onChange)

  return () => {
    globalThis.removeEventListener('online', onChange)
    globalThis.removeEventListener('offline', onChange)
  }
}

function isOnline() {
  return navigator.onLine
}

/** Whether the browser believes it has a network connection. */
export function useOnline() {
  return useSyncExternalStore(subscribe, isOnline)
}
