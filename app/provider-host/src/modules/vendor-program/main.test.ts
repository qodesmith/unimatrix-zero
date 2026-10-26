import {createHash} from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {gzipSync} from 'node:zlib'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {getProgramReady, programOf} from './main'

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

interface TarEntry {
  name: string
  body?: string
  mode?: number
  /** `0` a file, `5` a folder, `x` a pax header, `2` a symbolic link. */
  type?: string
}

function tarGz(entries: TarEntry[]) {
  const blocks = entries.flatMap(({name, body = '', mode = 0o644, type}) => {
    const header = Buffer.alloc(512)
    const content = Buffer.from(body)
    const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512)
    content.copy(padded)
    header.write(name, 0)
    header.write(`${mode.toString(8).padStart(7, '0')}\0`, 100)
    header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124)
    header.write(type ?? (name.endsWith('/') ? '5' : '0'), 156)
    header.write('ustar\u000000', 257)

    return [header, padded]
  })

  return new Uint8Array(
    gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]))
  )
}

function folderBuild(packed: Uint8Array) {
  return {
    url: 'https://downloads.example.com/codex.tar.gz',
    sha256: createHash('sha256').update(packed).digest('hex'),
    size: packed.byteLength,
    archive: {format: 'tar.gz' as const, entrypoint: 'bin/codex-app-server'},
  }
}

describe('a folder build', () => {
  const archive = tarGz([
    {name: 'bin/'},
    {name: 'PaxHeader', type: 'x', body: '30 path=bin/codex-app-server\n'},
    {name: 'bin/truncated-name', body: '#!/bin/sh\n', mode: 0o755},
    {name: 'codex-package.json', body: '{}'},
    {name: 'codex-path/'},
    {name: 'codex-path/rg', body: 'rg', mode: 0o755},
  ])

  beforeEach(() => {
    target = {path: path.join(folder, '0.163.0'), build: folderBuild(archive)}
  })

  it('unpacks the checked archive where the program goes', async () => {
    await ready(serving(archive))

    expect(programOf(target)).toBe(
      path.join(folder, '0.163.0', 'bin', 'codex-app-server')
    )
    expect(await fs.readFile(programOf(target), 'utf8')).toBe('#!/bin/sh\n')
    expect((await filesIn(folder)).toSorted()).toEqual(
      [
        '0.163.0',
        '0.163.0.sha256',
        path.join('0.163.0', 'bin'),
        path.join('0.163.0', 'bin', 'codex-app-server'),
        path.join('0.163.0', 'codex-package.json'),
        path.join('0.163.0', 'codex-path'),
        path.join('0.163.0', 'codex-path', 'rg'),
      ].toSorted()
    )
  })

  it.skipIf(process.platform === 'win32')(
    'keeps what the archive marks runnable',
    async () => {
      await ready(serving(archive))

      await expect(
        fs.access(programOf(target), fs.constants.X_OK)
      ).resolves.toBeUndefined()
      await expect(
        fs.access(
          path.join(target.path, 'codex-package.json'),
          fs.constants.X_OK
        )
      ).rejects.toThrow('EACCES')
    }
  )

  it('downloads nothing when that build is already unpacked', async () => {
    await ready(serving(archive))
    const fetch = serving(archive)

    expect(await ready(fetch)).toEqual([])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('unpacks again when the program is missing from the folder', async () => {
    await ready(serving(archive))
    await fs.rm(programOf(target))

    await ready(serving(archive))

    expect(await fs.readFile(programOf(target), 'utf8')).toBe('#!/bin/sh\n')
  })

  it('replaces the folder of another build', async () => {
    await ready(serving(archive))
    const other = tarGz([{name: 'bin/codex-app-server', body: 'new'}])
    target = {path: target.path, build: folderBuild(other)}

    await ready(serving(other))

    expect(await fs.readFile(programOf(target), 'utf8')).toBe('new')
    expect(await filesIn(path.join(target.path, 'bin'))).toEqual([
      'codex-app-server',
    ])
  })

  it.each([
    ['a path outside the folder', {name: '../escaped', body: 'x'}],
    ['a link', {name: 'bin/link', type: '2'}],
  ])('throws and keeps nothing for %s', async (_case, entry) => {
    const bad = tarGz([{name: 'bin/codex-app-server', body: 'x'}, entry])
    target = {path: target.path, build: folderBuild(bad)}

    await expect(ready(serving(bad))).rejects.toThrow('The archive has')
    expect(await filesIn(folder)).toEqual([])
  })
})
