import {onTestFinished} from 'vitest'

export function goOffline() {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => false,
  })
  globalThis.dispatchEvent(new Event('offline'))
  onTestFinished(() => {
    goOnline()
  })
}

export function goOnline() {
  Reflect.deleteProperty(navigator, 'onLine')
  globalThis.dispatchEvent(new Event('online'))
}
