declare const __UZ_DEV__: boolean

export interface DevRun {
  vitePort: number
  scriptNonce: string
  /** `bun run dev --fake`: Claude is connected, answered by the fake driver. */
  fakeProvider: boolean
}

/**
 * The dev script sets these. A production build defines `__UZ_DEV__` as
 * false, so a packaged main never reads them.
 */
export function readDevRun(env: NodeJS.ProcessEnv): DevRun | null {
  if (!__UZ_DEV__ || env.UZ_DEV !== '1') return null
  const vitePort = Number(env.UZ_DEV_VITE_PORT)
  const scriptNonce = env.UZ_DEV_NONCE ?? ''

  if (!vitePort || !scriptNonce) {
    throw new Error('UZ_DEV=1 needs UZ_DEV_VITE_PORT and UZ_DEV_NONCE')
  }

  return {vitePort, scriptNonce, fakeProvider: env.UZ_DEV_FAKE === '1'}
}
