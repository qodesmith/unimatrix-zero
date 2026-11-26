import type {SignInRequest} from '@uz/contract/host'
import type {Manifest, VendorProgram} from '@uz/contract/manifest'
import type {ProviderId} from '@uz/contract/providers'
import type {ProgramTarget} from '@uz/vendor-program'

import {ManifestSchema, PlatformSchema} from '@uz/contract/manifest'
import path from 'node:path'
import {z} from 'zod'

import devManifest from './dev-manifest.json'

/** Names the vendor programs until the app reads the signed manifest. */
export const DEV_MANIFEST: Manifest = ManifestSchema.parse(devManifest)

export interface Machine {
  userData: string
  platform: NodeJS.Platform
  arch: string
  /** As `2.39`; absent off Linux, or when unknown. */
  glibcVersion?: string
}

const ProcessReportSchema = z.object({
  header: z.object({glibcVersionRuntime: z.string()}),
})

/** From Node's own report, so no program runs. */
export function readGlibcVersion() {
  if (process.platform !== 'linux') return undefined

  const parsed = ProcessReportSchema.safeParse(process.report.getReport())

  return parsed.success ? parsed.data.header.glibcVersionRuntime : undefined
}

/** Dugite-native's Linux builds need glibc 2.34 or newer (ADR 0024). */
export function needsNewerLinux({platform, glibcVersion}: Machine) {
  if (platform !== 'linux' || glibcVersion === undefined) return false

  const [major = 0, minor = 0] = glibcVersion.split('.').map(Number)

  return major < 2 || (major === 2 && minor < 34)
}

const PROGRAMS = {
  claude: 'claude',
  chatgpt: 'codex',
} as const satisfies Record<ProviderId, keyof Manifest['vendorPrograms']>

function buildFor({builds}: VendorProgram, {platform, arch}: Machine) {
  const target = PlatformSchema.safeParse(`${platform}-${arch}`)

  return target.success ? builds[target.data] : undefined
}

export function gitTargetFor(
  machine: Machine,
  manifest: Manifest = DEV_MANIFEST
): ProgramTarget | null {
  if (needsNewerLinux(machine)) return null

  const {git} = manifest.vendorPrograms
  const build = buildFor(git, machine)
  const folder = path.join(machine.userData, 'vendor', 'git', git.version)

  return build ? {path: folder, build} : null
}

export function developerFolderFor({userData, platform}: Machine) {
  return platform === 'darwin' ? path.join(userData, 'developer') : null
}

/**
 * Goes last on the `PATH` of `claude` and Codex. It holds the app's `git`
 * wrapper, so it's on `PATH` from the first session (ADR 0026).
 */
export function gitFolderFor(
  machine: Machine,
  manifest: Manifest = DEV_MANIFEST
) {
  if (!gitTargetFor(machine, manifest)) return null

  return machine.platform === 'win32' || machine.platform === 'linux'
    ? path.join(machine.userData, 'git')
    : null
}

/** Each Provider's sign-in and session data, in a folder of its own. */
export function providersFolderOf(userData: string) {
  return path.join(userData, 'providers')
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
    configDir: path.join(providersFolderOf(userData), provider),
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
