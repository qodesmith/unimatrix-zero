import type {CommandResult} from '@uz/contract/commands'

/** Larger images are refused rather than held in memory as a data URL. */
export const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024

/** A server that never answers hands the chip back to the user. */
const TIMEOUT_MS = 30_000

export type RemoteImages = ReturnType<typeof createRemoteImages>

function notAnImage() {
  return new Error('The link does not point at an image.')
}

async function fetchOrTimeOut(
  fetch: typeof globalThis.fetch,
  url: string,
  timeoutMs: number
) {
  try {
    return await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error('The image took too long to load.', {cause: error})
    }

    throw error
  }
}

/**
 * Loads the remote images a Reply links, one click each (ADR 0014). Node's
 * fetch rather than the window session's, so the session's http backstop
 * stays absolute and no cookie jar or referrer ever travels with the request.
 */
export function createRemoteImages(
  fetch: typeof globalThis.fetch,
  {timeoutMs = TIMEOUT_MS}: {timeoutMs?: number} = {}
) {
  async function load(url: string): Promise<CommandResult<'image.load'>> {
    const response = await fetchOrTimeOut(fetch, url, timeoutMs)

    if (!response.ok) {
      throw new Error(`The image could not be loaded (${response.status}).`)
    }

    const mediaType = response.headers
      .get('Content-Type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()

    if (!mediaType?.startsWith('image/')) throw notAnImage()

    const bytes = new Uint8Array(await response.arrayBuffer())

    if (bytes.byteLength > IMAGE_SIZE_LIMIT) {
      throw new Error(
        `The image is larger than ${IMAGE_SIZE_LIMIT / 1024 / 1024} MB.`
      )
    }

    return {dataUrl: `data:${mediaType};base64,${bytes.toBase64()}`}
  }

  return {load}
}
