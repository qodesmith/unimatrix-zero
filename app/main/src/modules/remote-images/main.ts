import type {CommandResult} from '@uz/contract/commands'

export const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024

const TIMEOUT_MS = 30_000

export const REDIRECT_LIMIT = 5

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export type RemoteImages = ReturnType<typeof createRemoteImages>

function notAnImage() {
  return new Error('The link does not point at an image.')
}

function tooLarge() {
  return new Error(
    `The image is larger than ${IMAGE_SIZE_LIMIT / 1024 / 1024} MB.`
  )
}

function redirectTarget(from: URL, response: Response) {
  const location = response.headers.get('Location')

  return REDIRECT_STATUSES.has(response.status) && location !== null
    ? new URL(location, from)
    : null
}

/**
 * A redirect may move the image to another host, but never off the web, and
 * never off https when the chip was https.
 */
function refusedHop(requested: URL, next: URL) {
  if (next.protocol === 'https:') return null

  if (next.protocol === 'http:') {
    return requested.protocol === 'http:'
      ? null
      : new Error('The image moved to an address that is not https.')
  }

  return new Error('The image moved to an address that is not a web address.')
}

/**
 * Checks each hop before requesting it. Node's `redirect: 'follow'` would make
 * the request first, so a secure chip could produce a request in the clear.
 */
async function follow(
  fetch: typeof globalThis.fetch,
  url: string,
  signal: AbortSignal
) {
  const requested = new URL(url)
  let at = requested

  for (let hop = 0; hop <= REDIRECT_LIMIT; hop++) {
    const response = await fetch(at.href, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'manual',
      signal,
    })

    const next = redirectTarget(at, response)

    if (next === null) return response

    await response.body?.cancel()

    const refused = refusedHop(requested, next)

    if (refused) throw refused

    at = next
  }

  throw new Error('The image redirected too many times.')
}

/**
 * Enforces the limit while reading, since a server may send no size or lie
 * about it. Leaving the loop cancels the stream, which closes the connection.
 */
async function readWithin(body: ReadableStream<Uint8Array>) {
  const chunks: Uint8Array[] = []
  let total = 0

  for await (const chunk of body) {
    total += chunk.byteLength

    if (total > IMAGE_SIZE_LIMIT) throw tooLarge()

    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

async function fetchImage(
  fetch: typeof globalThis.fetch,
  url: string,
  timeoutMs: number
): Promise<CommandResult<'image.load'>> {
  const response = await follow(fetch, url, AbortSignal.timeout(timeoutMs))

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

  const bytes = await readWithin(response.body)

  return {dataUrl: `data:${mediaType};base64,${bytes.toBase64()}`}
}

/**
 * Node's fetch rather than the window session's, so the session's http
 * backstop stays absolute and no cookie jar or referrer travels with it
 * (ADR 0014).
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
