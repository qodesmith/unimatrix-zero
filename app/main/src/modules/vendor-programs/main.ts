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

/**
 * What connecting a Provider needs on this machine: where its exact vendor
 * program goes under `userData`, what to download, and its own configuration
 * folder. The program is null when the manifest names none for the Provider
 * or this machine.
 */
export function signInRequestFor(
  provider: ProviderId,
  {userData, platform, arch}: Machine,
  manifest: Manifest = DEV_MANIFEST
): SignInRequest {
  const configDir = path.join(userData, 'providers', provider)
  const target = PlatformSchema.safeParse(`${platform}-${arch}`)
  const program = provider === 'claude' ? manifest.vendorPrograms.claude : null

  if (!program || !target.success) return {program: null, configDir}

  const file = platform === 'win32' ? 'claude.exe' : 'claude'

  return {
    program: {
      path: path.join(userData, 'vendor', provider, program.version, file),
      build: program.builds[target.data],
    },
    configDir,
  }
}
