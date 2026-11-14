import type {HostAttachment} from '@uz/contract/attachments'

import {readFile} from 'node:fs/promises'
import path from 'node:path'

import {readCache, writeCache} from './cache'
import {convertBytes} from './convert'

/**
 * One page of a PDF, for a Provider that can't take the PDF itself. `image` is
 * the page rendered as a PNG, set when the page has no text or images cover
 * more than about a tenth of it.
 */
export interface ConvertedPage {
  text: string
  image: Uint8Array | null
}

/**
 * Converts from the original every time it isn't cached, so a hand-over never
 * converts a conversion. Cached under `conversionDir` by the original's
 * SHA-256.
 */
export async function convertPdf(
  original: HostAttachment,
  conversionDir: string
): Promise<ConvertedPage[]> {
  const folder = path.join(conversionDir, original.sha256)
  const cached = await readCache(folder)

  if (cached) return cached

  const pages = await convertBytes(
    original.name,
    new Uint8Array(await readFile(original.path))
  )

  // A conversion that can't be cached is still sent, and made again next time.
  await writeCache(folder, pages).catch(() => undefined)

  return pages
}
