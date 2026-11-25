declare const __UZ_DEV__: boolean

export interface DevRun {
  vitePort: number
  scriptNonce: string
  fakeProvider: boolean
  /** Every Reply runs Supervised; a dev-only stand-in for the Setting. */
  supervised: boolean
}

/** `__UZ_DEV__` is false in production, so no packaged main reads these. */
export function readDevRun(env: NodeJS.ProcessEnv): DevRun | null {
  if (!__UZ_DEV__ || env.UZ_DEV !== '1') return null
  const vitePort = Number(env.UZ_DEV_VITE_PORT)
  const scriptNonce = env.UZ_DEV_NONCE ?? ''

  if (!vitePort || !scriptNonce) {
    throw new Error('UZ_DEV=1 needs UZ_DEV_VITE_PORT and UZ_DEV_NONCE')
  }

  return {
    vitePort,
    scriptNonce,
    fakeProvider: env.UZ_DEV_FAKE === '1',
    supervised: env.UZ_DEV_SUPERVISED === '1',
  }
}
