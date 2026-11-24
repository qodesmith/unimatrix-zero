import type {Bridge} from '@uz/contract/bridge'

declare global {
  interface Window {
    uz: Bridge
  }
}

/** The preload's `window.uz`: the renderer's only way to reach main. */
export function bridge(): Bridge {
  return globalThis.window.uz
}
