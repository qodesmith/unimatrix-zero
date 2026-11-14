import type {ConvertedPage} from './main'

import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises'
import path from 'node:path'
import {z} from 'zod'

const MANIFEST = 'manifest.json'

/** Raised whenever what a page converts to changes, so older ones convert again. */
const CONVERSION_VERSION = 1

const ManifestSchema = z.strictObject({
  version: z.literal(CONVERSION_VERSION),
  pages: z.array(
    z.strictObject({
      text: z.string(),
      image: z
        .string()
        .regex(/^page-\d+\.png$/u)
        .nullable(),
    })
  ),
})

type Manifest = z.infer<typeof ManifestSchema>

/** The conversion cached in `folder`, or null when none is, whole. */
export async function readCache(
  folder: string
): Promise<ConvertedPage[] | null> {
  try {
    const manifest = ManifestSchema.parse(
      JSON.parse(await readFile(path.join(folder, MANIFEST), 'utf8'))
    )

    return await Promise.all(
      manifest.pages.map(async ({text, image}) => ({
        text,
        image:
          image === null
            ? null
            : new Uint8Array(await readFile(path.join(folder, image))),
      }))
    )
  } catch {
    return null
  }
}

/**
 * Writes the conversion into a folder beside `folder`, then renames it into
 * place, so a reader finds a whole conversion or none.
 */
export async function writeCache(folder: string, pages: ConvertedPage[]) {
  await mkdir(path.dirname(folder), {recursive: true})
  const partial = await mkdtemp(`${folder}.partial-`)

  try {
    const manifest: Manifest = {version: CONVERSION_VERSION, pages: []}

    for (const [index, {text, image}] of pages.entries()) {
      const name = image ? `page-${index + 1}.png` : null

      if (image && name) await writeFile(path.join(partial, name), image)
      manifest.pages.push({text, image: name})
    }

    await writeFile(path.join(partial, MANIFEST), JSON.stringify(manifest))
    await rm(folder, {recursive: true, force: true})
    await rename(partial, folder)
  } finally {
    await rm(partial, {recursive: true, force: true})
  }
}
