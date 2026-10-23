import {expect, it} from 'vitest'

import {IMAGE_SIZE_LIMIT, REDIRECT_LIMIT, createRemoteImages} from './main'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

interface Served {
  status?: number
  type?: string | null
  length?: number
  body?: Uint8Array | ReadableStream<Uint8Array>
}

/**
 * The network as main sees it, keeping every request it was sent. Addresses
 * in `redirects` answer with a 302 to where they point; any other serves the
 * image.
 */
function fakeFetch(
  {status = 200, type = 'image/png', length, body = png}: Served,
  redirects: Record<string, string> = {}
) {
  const requests: ({url: string} & RequestInit)[] = []

  async function fetch(...[input, init]: Parameters<typeof globalThis.fetch>) {
    const {url} = new Request(input)

    requests.push({url, ...init})

    const to = redirects[url]

    if (to !== undefined) {
      return new Response(null, {status: 302, headers: {Location: to}})
    }

    const headers = new Headers()

    if (type !== null) headers.set('Content-Type', type)

    if (length !== undefined) headers.set('Content-Length', String(length))

    return new Response(body, {status, headers})
  }

  return {fetch, requests}
}

it('fetches the image without cookies or a referrer and answers a data URL', async () => {
  const network = fakeFetch({})
  const images = createRemoteImages(network.fetch)

  const loaded = await images.load('https://example.com/chart.png')

  expect(loaded).toEqual({dataUrl: 'data:image/png;base64,iVBORw=='})
  expect(network.requests).toHaveLength(1)
  expect(network.requests[0]).toMatchObject({
    url: 'https://example.com/chart.png',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
  })
})

it('keeps only the media type of what the server sent', async () => {
  const images = createRemoteImages(
    fakeFetch({type: 'image/svg+xml; charset=utf-8'}).fetch
  )

  await expect(images.load('https://example.com/a.svg')).resolves.toEqual({
    dataUrl: 'data:image/svg+xml;base64,iVBORw==',
  })
})

it('refuses a response that is not an image', async () => {
  const images = createRemoteImages(fakeFetch({type: 'text/html'}).fetch)

  await expect(images.load('https://example.com/page')).rejects.toThrow(
    'The link does not point at an image.'
  )
})

it('refuses a response with no media type', async () => {
  const images = createRemoteImages(fakeFetch({type: null}).fetch)

  await expect(images.load('https://example.com/blob')).rejects.toThrow(
    'The link does not point at an image.'
  )
})

it('follows a redirect to another https host, one hop at a time', async () => {
  const network = fakeFetch(
    {},
    {'https://example.com/chart.png': 'https://cdn.example.net/chart.png'}
  )

  const images = createRemoteImages(network.fetch)

  await expect(images.load('https://example.com/chart.png')).resolves.toEqual({
    dataUrl: 'data:image/png;base64,iVBORw==',
  })
  expect(network.requests.map(request => request.url)).toEqual([
    'https://example.com/chart.png',
    'https://cdn.example.net/chart.png',
  ])
  expect(network.requests[0]).toMatchObject({redirect: 'manual'})
})

it('resolves a relative redirect against the address it came from', async () => {
  const network = fakeFetch(
    {},
    {'https://example.com/chart.png': '/images/chart.png'}
  )

  const images = createRemoteImages(network.fetch)

  await expect(images.load('https://example.com/chart.png')).resolves.toEqual({
    dataUrl: 'data:image/png;base64,iVBORw==',
  })
  expect(network.requests.at(-1)?.url).toBe(
    'https://example.com/images/chart.png'
  )
})

it('refuses a redirect that leaves https before requesting it', async () => {
  const network = fakeFetch(
    {},
    {'https://example.com/chart.png': 'http://127.0.0.1/chart.png'}
  )

  const images = createRemoteImages(network.fetch)

  await expect(images.load('https://example.com/chart.png')).rejects.toThrow(
    'The image moved to an address that is not https.'
  )
  expect(network.requests.map(request => request.url)).toEqual([
    'https://example.com/chart.png',
  ])
})

it('refuses a redirect off the web, even from an http chip', async () => {
  const network = fakeFetch(
    {},
    {'http://example.com/chart.png': 'file:///etc/passwd'}
  )

  const images = createRemoteImages(network.fetch)

  await expect(images.load('http://example.com/chart.png')).rejects.toThrow(
    'The image moved to an address that is not a web address.'
  )
  expect(network.requests).toHaveLength(1)
})

it('gives up on a redirect loop', async () => {
  const network = fakeFetch(
    {},
    {'https://example.com/chart.png': 'https://example.com/chart.png'}
  )

  const images = createRemoteImages(network.fetch)

  await expect(images.load('https://example.com/chart.png')).rejects.toThrow(
    'The image redirected too many times.'
  )
  expect(network.requests).toHaveLength(REDIRECT_LIMIT + 1)
})

it('says when the server refused', async () => {
  const images = createRemoteImages(fakeFetch({status: 404}).fetch)

  await expect(images.load('https://example.com/gone.png')).rejects.toThrow(
    'The image could not be loaded (404).'
  )
})

/** Rejects once the request is aborted, as a fetch that is cut off does. */
async function untilAborted(signal: AbortSignal | null | undefined) {
  return new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason))
  })
}

/** A server that never answers; the request ends only when it is aborted. */
async function stalled(...[, init]: Parameters<typeof globalThis.fetch>) {
  return untilAborted(init?.signal)
}

it('gives up on a server that never answers', async () => {
  const images = createRemoteImages(stalled, {timeoutMs: 10})

  await expect(images.load('https://example.com/slow.png')).rejects.toThrow(
    'The image took too long to load.'
  )
})

/** A server that sends the headers and then never finishes the body. */
async function stalledBody(...[, init]: Parameters<typeof globalThis.fetch>) {
  const body = new ReadableStream<Uint8Array>({
    async pull() {
      await untilAborted(init?.signal)
    },
  })

  return new Response(body, {headers: {'Content-Type': 'image/png'}})
}

it('gives up on a body that never finishes', async () => {
  const images = createRemoteImages(stalledBody, {timeoutMs: 10})

  await expect(images.load('https://example.com/slow.png')).rejects.toThrow(
    'The image took too long to load.'
  )
})

it('refuses an image larger than the limit', async () => {
  const images = createRemoteImages(
    fakeFetch({body: new Uint8Array(IMAGE_SIZE_LIMIT + 1)}).fetch
  )

  await expect(images.load('https://example.com/huge.png')).rejects.toThrow(
    'The image is larger than 20 MB.'
  )
})

it('refuses an image the server says is too large before reading it', async () => {
  let pulled = false

  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulled = true
        controller.close()
      },
    },
    {highWaterMark: 0}
  )

  const images = createRemoteImages(
    fakeFetch({length: IMAGE_SIZE_LIMIT + 1, body}).fetch
  )

  await expect(images.load('https://example.com/huge.png')).rejects.toThrow(
    'The image is larger than 20 MB.'
  )

  expect(pulled).toBe(false)
})

it('stops reading a body that grows past the limit', async () => {
  const chunk = new Uint8Array(1024 * 1024)
  let sent = 0
  let canceled = false

  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += chunk.byteLength
      controller.enqueue(chunk)
    },
    cancel() {
      canceled = true
    },
  })

  const images = createRemoteImages(fakeFetch({body}).fetch)

  await expect(images.load('https://example.com/endless.png')).rejects.toThrow(
    'The image is larger than 20 MB.'
  )

  expect(canceled).toBe(true)
  expect(sent).toBeLessThanOrEqual(IMAGE_SIZE_LIMIT + 2 * chunk.byteLength)
})
