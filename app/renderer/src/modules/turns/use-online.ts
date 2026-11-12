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

export function useOnline() {
  return useSyncExternalStore(subscribe, isOnline)
}
