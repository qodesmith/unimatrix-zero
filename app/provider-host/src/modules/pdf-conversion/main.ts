import type {HostAttachment} from '@uz/contract/attachments'

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
 * converts a conversion. Cached under `conversionDir` by the original's SHA-256.
 */
export async function convertPdf(
  _original: HostAttachment,
  _conversionDir: string
): Promise<ConvertedPage[]> {
  throw new Error('Not built yet.')
}
