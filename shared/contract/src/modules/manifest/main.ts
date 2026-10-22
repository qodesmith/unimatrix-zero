import {z} from 'zod'

/** `<process.platform>-<process.arch>` for every OS and arch the app ships on. */
export const PlatformSchema = z.enum([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
])

export type Platform = z.infer<typeof PlatformSchema>

/** One vendor program file, downloaded from its vendor and checked by hash. */
export const VendorBuildSchema = z.strictObject({
  url: z.url({protocol: /^https$/}),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().positive(),
})

export type VendorBuild = z.infer<typeof VendorBuildSchema>

export const VendorProgramSchema = z.strictObject({
  version: z.string().min(1),
  builds: z.record(PlatformSchema, VendorBuildSchema),
})

/**
 * What an app bundle runs: the exact vendor program builds (ADR 0008). The
 * signed manifest (ADR 0007) carries this beside the bundles.
 */
export const ManifestSchema = z.strictObject({
  vendorPrograms: z.strictObject({claude: VendorProgramSchema}),
})

export type Manifest = z.infer<typeof ManifestSchema>
