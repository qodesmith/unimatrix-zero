import type {SignInRequest} from '@uz/contract/host'
import type {Manifest, VendorProgram} from '@uz/contract/manifest'
import type {ProviderId} from '@uz/contract/providers'
import type {ProgramTarget} from '@uz/vendor-program'

import {ManifestSchema, PlatformSchema} from '@uz/contract/manifest'
import {programOf} from '@uz/vendor-program'
import path from 'node:path'

import devManifest from './dev-manifest.json'

/** Names the vendor programs until the app reads the signed manifest. */
export const DEV_MANIFEST: Manifest = ManifestSchema.parse(devManifest)

export interface Machine {
  userData: string
  platform: NodeJS.Platform
  arch: string
}

const PROGRAMS = {
  claude: 'claude',
  chatgpt: 'codex',
} as const satisfies Record<ProviderId, keyof Manifest['vendorPrograms']>

function buildFor({builds}: VendorProgram, {platform, arch}: Machine) {
  const target = PlatformSchema.safeParse(`${platform}-${arch}`)

  return target.success ? builds[target.data] : undefined
}

/**
 * The app's own `git` for this machine, as the folder its archive unpacks to;
 * null when the manifest has none for it (ADR 0024).
 */
export function gitTargetFor(
  machine: Machine,
  manifest: Manifest = DEV_MANIFEST
): ProgramTarget | null {
  const {git} = manifest.vendorPrograms
  const build = buildFor(git, machine)
  const folder = path.join(machine.userData, 'vendor', 'git', git.version)

  return build ? {path: folder, build} : null
}

/**
 * The developer folder the app gives a Mac with no developer tools (ADR
 * 0025); null off a Mac, where there are no stubs to answer.
 */
export function developerFolderFor({userData, platform}: Machine) {
  return platform === 'darwin' ? path.join(userData, 'developer') : null
}

/**
 * The folder that goes last on the `PATH` of `claude` and Codex: on Windows
 * the build's own `cmd`, on Linux the one the app's wrapper script is in.
 */
export function gitFolderFor(
  machine: Machine,
  manifest: Manifest = DEV_MANIFEST
) {
  const target = gitTargetFor(machine, manifest)

  if (!target) return null

  if (machine.platform === 'win32') return path.dirname(programOf(target))

  return machine.platform === 'linux'
    ? path.join(machine.userData, 'git')
    : null
}

export function signInRequestFor(
  provider: ProviderId,
  machine: Machine,
  manifest: Manifest = DEV_MANIFEST
): SignInRequest {
  const {userData, platform} = machine
  const developerDir = developerFolderFor(machine)
  const gitFolder = gitFolderFor(machine, manifest)

  const folders = {
    configDir: path.join(userData, 'providers', provider),
    ...(developerDir && {developerDir}),
    ...(gitFolder && {gitFolder}),
  }

  const name = PROGRAMS[provider]
  const program = manifest.vendorPrograms[name]
  const build = buildFor(program, machine)

  if (!build) return {program: null, ...folders}

  const folder = path.join(userData, 'vendor', provider, program.version)
  const file = platform === 'win32' ? `${name}.exe` : name

  return {
    program: {path: build.archive ? folder : path.join(folder, file), build},
    ...folders,
  }
}
