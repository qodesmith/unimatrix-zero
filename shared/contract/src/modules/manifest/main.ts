import {z} from 'zod'

export const PlatformSchema = z.enum([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-arm64',
  'win32-x64',
])

export type Platform = z.infer<typeof PlatformSchema>

export const VendorBuildSchema = z.strictObject({
  url: z.url({protocol: /^https$/}),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().positive(),
  archive: z
    .strictObject({
      format: z.literal('tar.gz'),
      entrypoint: z.string().min(1),
    })
    .optional(),
})

export type VendorBuild = z.infer<typeof VendorBuildSchema>

export const VendorProgramSchema = z.strictObject({
  version: z.string().min(1),
  builds: z.record(PlatformSchema, VendorBuildSchema),
})

export type VendorProgram = z.infer<typeof VendorProgramSchema>

export const ManifestSchema = z.strictObject({
  vendorPrograms: z.strictObject({
    claude: VendorProgramSchema,
    codex: VendorProgramSchema,
    git: VendorProgramSchema,
  }),
})

export type Manifest = z.infer<typeof ManifestSchema>
