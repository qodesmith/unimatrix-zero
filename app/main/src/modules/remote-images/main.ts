import type {CommandResult} from '@uz/contract/commands'

/** Larger images are refused rather than held in memory as a data URL. */
export const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024

export type RemoteImages = ReturnType<typeof createRemoteImages>

function notAnImage() {
  return new Error('The link does not point at an image.')
}

/**
 * Loads the remote images a Reply links, one click each (ADR 0014). Node's
 * fetch rather than the window session's, so the session's http backstop
 * stays absolute and no cookie jar or referrer ever travels with the request.
 */
export function createRemoteImages(fetch: typeof globalThis.fetch) {
  async function load(url: string): Promise<CommandResult<'image.load'>> {
    const response = await fetch(url, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
    })

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
