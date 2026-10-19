export type DevRun = {
  vitePort: number
  scriptNonce: string
}

/** The dev script sets these; a packaged build sees none of them. */
export function readDevRun(env: NodeJS.ProcessEnv): DevRun | null {
  if (env.UZ_DEV !== '1') return null
  const vitePort = Number(env.UZ_DEV_VITE_PORT)
  const scriptNonce = env.UZ_DEV_NONCE ?? ''
  if (!vitePort || !scriptNonce) {
    throw new Error('UZ_DEV=1 needs UZ_DEV_VITE_PORT and UZ_DEV_NONCE')
  }
  return {vitePort, scriptNonce}
}
