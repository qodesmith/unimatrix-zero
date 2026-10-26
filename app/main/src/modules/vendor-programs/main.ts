import type {SignInRequest} from '@uz/contract/host'
import type {Manifest} from '@uz/contract/manifest'
import type {ProviderId} from '@uz/contract/providers'

import {ManifestSchema, PlatformSchema} from '@uz/contract/manifest'
import path from 'node:path'

import devManifest from './dev-manifest.json'

/** Names the vendor programs until the app reads the signed manifest. */
export const DEV_MANIFEST: Manifest = ManifestSchema.parse(devManifest)

interface Machine {
  userData: string
  platform: NodeJS.Platform
  arch: string
}

const PROGRAMS = {
  claude: 'claude',
  chatgpt: 'codex',
} as const satisfies Record<ProviderId, keyof Manifest['vendorPrograms']>

export function signInRequestFor(
  provider: ProviderId,
  {userData, platform, arch}: Machine,
  manifest: Manifest = DEV_MANIFEST
): SignInRequest {
  const configDir = path.join(userData, 'providers', provider)
  const target = PlatformSchema.safeParse(`${platform}-${arch}`)
  const name = PROGRAMS[provider]
  const program = manifest.vendorPrograms[name]
  const build = target.success ? program.builds[target.data] : undefined

  if (!build) return {program: null, configDir}

  const folder = path.join(userData, 'vendor', provider, program.version)
  const file = platform === 'win32' ? `${name}.exe` : name

  return {
    program: {path: build.archive ? folder : path.join(folder, file), build},
    configDir,
  }
}
