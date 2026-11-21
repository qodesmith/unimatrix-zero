import type {SignInRequest} from '@uz/contract/host'
import type {Manifest} from '@uz/contract/manifest'
import type {ProviderId} from '@uz/contract/providers'
import type {ProgramTarget} from '@uz/vendor-program'

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

/**
 * The app's own `git` for this machine, as the folder its archive unpacks to;
 * null when the manifest has none for it (ADR 0024).
 */
export function gitTargetFor(
  {userData, platform, arch}: Machine,
  manifest: Manifest = DEV_MANIFEST
): ProgramTarget | null {
  const target = PlatformSchema.safeParse(`${platform}-${arch}`)
  const {version, builds} = manifest.helpers.git
  const build = target.success ? builds[target.data] : undefined

  return build
    ? {path: path.join(userData, 'vendor', 'git', version), build}
    : null
}

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
