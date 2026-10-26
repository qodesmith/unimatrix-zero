import type {SignInRequest} from '@uz/contract/host'
import type {SignInUpdate} from '@uz/contract/providers'

import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

import {untar} from './untar'

export type DownloadProgress = NonNullable<
  Extract<SignInUpdate, {type: 'SIGN_IN_STEP'}>['progress']
>

export type ProgramTarget = NonNullable<SignInRequest['program']>

interface ReadyOptions {
  signal: AbortSignal
  fetch?: typeof globalThis.fetch
}

async function sha256Of(file: string) {
  const hash = createHash('sha256')

  for await (const chunk of createReadStream(file)) hash.update(chunk)

  return hash.digest('hex')
}

/** What a folder's build is noted in once it is unpacked, beside the folder. */
function noteOf(folder: string) {
  return `${folder}.sha256`
}

/** The program to run: the file itself, or the entrypoint in its folder. */
export function programOf({path: place, build}: ProgramTarget) {
  return build.archive
    ? path.join(place, ...build.archive.entrypoint.split('/'))
    : place
}

async function isInPlace(target: ProgramTarget) {
  const {path: place, build} = target

  try {
    if (!build.archive) return (await sha256Of(place)) === build.sha256

    await fs.access(programOf(target))

    return (await fs.readFile(noteOf(place), 'utf8')) === build.sha256
  } catch {
    return false
  }
}

async function unpackInPlace(
  archive: string,
  {path: folder, build}: ProgramTarget,
  signal: AbortSignal
) {
  const unpacking = `${folder}.unpack`

  try {
    await fs.rm(unpacking, {recursive: true, force: true})
    await untar(archive, unpacking, signal)
    await fs.rm(noteOf(folder), {force: true})
    await fs.rm(folder, {recursive: true, force: true})
    await fs.rename(unpacking, folder)
    await fs.writeFile(noteOf(folder), build.sha256)
  } finally {
    await fs.rm(unpacking, {recursive: true, force: true})
  }
}

/**
 * The download goes beside `path` and is moved or unpacked into place only once
 * its size and hash match; anything else throws and leaves nothing behind.
 */
export async function* getProgramReady(
  target: ProgramTarget,
  {signal, fetch = globalThis.fetch}: ReadyOptions
): AsyncGenerator<DownloadProgress> {
  if (await isInPlace(target)) return

  const {build} = target
  const partial = `${target.path}.download`
  await fs.mkdir(path.dirname(target.path), {recursive: true})

  try {
    const response = await fetch(build.url, {signal})

    if (!response.ok || !response.body) {
      throw new Error(`The download answered ${response.status}.`)
    }

    const hash = createHash('sha256')
    const file = await fs.open(partial, 'w', 0o755)
    const step = Math.ceil(build.size / 100)
    let received = 0
    let reported = 0

    try {
      yield {receivedBytes: 0, totalBytes: build.size}

      for await (const chunk of response.body) {
        signal.throwIfAborted()
        received += chunk.byteLength

        if (received > build.size) {
          throw new Error('The download is larger than the manifest says.')
        }

        hash.update(chunk)
        await file.write(chunk)

        if (received - reported >= step || received === build.size) {
          reported = received
          yield {receivedBytes: received, totalBytes: build.size}
        }
      }
    } finally {
      await file.close()
    }

    if (received !== build.size || hash.digest('hex') !== build.sha256) {
      throw new Error('The download does not match the manifest.')
    }

    if (build.archive) {
      await unpackInPlace(partial, target, signal)
    } else {
      await fs.rm(target.path, {force: true})
      await fs.rename(partial, target.path)
    }
  } finally {
    await fs.rm(partial, {force: true})
  }
}
