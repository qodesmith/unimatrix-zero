import {expect, it} from 'vitest'

import {IMAGE_SIZE_LIMIT, createRemoteImages} from './main'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

interface Served {
  status?: number
  type?: string | null
  body?: Uint8Array
}

/** The network as main sees it, keeping the request it was sent. */
function fakeFetch({status = 200, type = 'image/png', body = png}: Served) {
  const requests: ({url: string} & RequestInit)[] = []

  async function fetch(...[input, init]: Parameters<typeof globalThis.fetch>) {
    requests.push({url: new Request(input).url, ...init})

    return new Response(body, {
      status,
      headers: type === null ? {} : {'Content-Type': type},
    })
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

it('says when the server refused', async () => {
  const images = createRemoteImages(fakeFetch({status: 404}).fetch)

  await expect(images.load('https://example.com/gone.png')).rejects.toThrow(
    'The image could not be loaded (404).'
  )
})

/** A server that never answers; the request ends only when it is aborted. */
async function stalled(...[, init]: Parameters<typeof globalThis.fetch>) {
  return new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}

it('gives up on a server that never answers', async () => {
  const images = createRemoteImages(stalled, {timeoutMs: 10})

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
