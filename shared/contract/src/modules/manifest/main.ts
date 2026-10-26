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

/** The program file itself, or an archive of the folder it runs from. */
export const VendorBuildSchema = z.strictObject({
  url: z.url({protocol: /^https$/}),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().positive(),
  /** Set when the download is a folder, unpacked where the program goes. */
  archive: z
    .strictObject({
      format: z.literal('tar.gz'),
      /** The program to run, relative to the folder, with `/` between parts. */
      entrypoint: z.string().min(1),
    })
    .optional(),
})

export type VendorBuild = z.infer<typeof VendorBuildSchema>

export const VendorProgramSchema = z.strictObject({
  version: z.string().min(1),
  builds: z.record(PlatformSchema, VendorBuildSchema),
})

/** The exact vendor program builds an app bundle runs. */
export const ManifestSchema = z.strictObject({
  vendorPrograms: z.strictObject({
    claude: VendorProgramSchema,
    codex: VendorProgramSchema,
  }),
})

export type Manifest = z.infer<typeof ManifestSchema>
