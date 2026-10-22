import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {getProgramReady} from './program'

const bytes = new Uint8Array(1000).map((_, index) => index % 251)

const build = {
  url: 'https://downloads.example.com/claude',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  size: bytes.byteLength,
}

let folder: string
let target: Parameters<typeof getProgramReady>[0]

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-program-'))
  target = {path: path.join(folder, '2.1.307', 'claude'), build}
})

afterEach(async () => {
  await fs.rm(folder, {recursive: true, force: true})
})

/** A server that sends `body` in 100-byte chunks. */
function serving(body: Uint8Array, status = 200) {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            for (let start = 0; start < body.byteLength; start += 100) {
              controller.enqueue(body.slice(start, start + 100))
            }

            controller.close()
          },
        }),
        {status}
      )
  )
}

async function ready(
  fetch: typeof globalThis.fetch,
  signal = new AbortController().signal
) {
  return Array.fromAsync(getProgramReady(target, {fetch, signal}))
}

async function filesIn(dir: string) {
  return fs.readdir(dir, {recursive: true})
}

it('downloads the build into place, reporting progress', async () => {
  const progress = await ready(serving(bytes))

  expect(progress[0]).toEqual({receivedBytes: 0, totalBytes: 1000})
  expect(progress.at(-1)).toEqual({receivedBytes: 1000, totalBytes: 1000})
  expect(await fs.readFile(target.path)).toEqual(Buffer.from(bytes))
  expect(await filesIn(folder)).toEqual([
    '2.1.307',
    path.join('2.1.307', 'claude'),
  ])
})

it.skipIf(process.platform === 'win32')(
  'makes the build runnable',
  async () => {
    await ready(serving(bytes))

    await expect(
      fs.access(target.path, fs.constants.X_OK)
    ).resolves.toBeUndefined()
  }
)

it('downloads nothing when the exact build is already in place', async () => {
  await ready(serving(bytes))
  const fetch = serving(bytes)

  expect(await ready(fetch)).toEqual([])
  expect(fetch).not.toHaveBeenCalled()
})

it('replaces a copy that does not match the manifest', async () => {
  await fs.mkdir(path.dirname(target.path), {recursive: true})
  await fs.writeFile(target.path, 'tampered')

  await ready(serving(bytes))

  expect(await fs.readFile(target.path)).toEqual(Buffer.from(bytes))
})

it('throws and keeps nothing when the download does not match the manifest', async () => {
  const wrong = bytes.toReversed()

  await expect(ready(serving(wrong))).rejects.toThrow('does not match')
  expect(await filesIn(folder)).toEqual(['2.1.307'])
})

it('throws when the server refuses', async () => {
  await expect(ready(serving(new Uint8Array(), 404))).rejects.toThrow('404')
})

it('throws and keeps nothing when the download is canceled', async () => {
  const controller = new AbortController()

  const progress = getProgramReady(target, {
    fetch: serving(bytes),
    signal: controller.signal,
  })

  await progress.next()
  await progress.next()
  controller.abort()

  await expect(Array.fromAsync(progress)).rejects.toThrow('aborted')
  expect(await filesIn(folder)).toEqual(['2.1.307'])
})
