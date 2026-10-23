import type {CommandResult} from '@uz/contract/commands'

export const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024

/** A server that never answers hands the chip back to the user. */
const TIMEOUT_MS = 30_000

export type RemoteImages = ReturnType<typeof createRemoteImages>

function notAnImage() {
  return new Error('The link does not point at an image.')
}

function tooLarge() {
  return new Error(
    `The image is larger than ${IMAGE_SIZE_LIMIT / 1024 / 1024} MB.`
  )
}

/**
 * Reads the body and stops the moment it passes the limit, so a server that
 * sends no size, or lies about it, still cannot fill main's memory. Leaving
 * the loop cancels the stream, which closes the connection.
 */
async function readWithin(body: ReadableStream<Uint8Array>, limit: number) {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of body) {
    total += chunk.byteLength

    if (total > limit) throw tooLarge()

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

async function fetchImage(
  fetch: typeof globalThis.fetch,
  url: string,
  timeoutMs: number
): Promise<CommandResult<'image.load'>> {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`The image could not be loaded (${response.status}).`)
  }

  const mediaType = response.headers
    .get('Content-Type')
    ?.split(';')[0]
    ?.trim()
    .toLowerCase()

  if (!mediaType?.startsWith('image/') || !response.body) throw notAnImage()

  if (Number(response.headers.get('Content-Length')) > IMAGE_SIZE_LIMIT) {
    throw tooLarge()
  }

  const bytes = await readWithin(response.body, IMAGE_SIZE_LIMIT)

  return {dataUrl: `data:${mediaType};base64,${bytes.toBase64()}`}
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
  async function load(url: string) {
    try {
      return await fetchImage(fetch, url, timeoutMs)
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error('The image took too long to load.', {cause: error})
      }

      throw error
    }
  }

  return {load}
}
