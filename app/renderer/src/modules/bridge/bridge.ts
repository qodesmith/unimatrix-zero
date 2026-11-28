import type {Bridge} from '@uz/contract/bridge'

declare global {
  interface Window {
    uz: Bridge
  }
}

export function bridge(): Bridge {
  return globalThis.window.uz
}
