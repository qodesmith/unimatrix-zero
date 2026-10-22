import type {SignInRequest} from '@uz/contract/host'
import type {SignInUpdate} from '@uz/contract/providers'

import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'

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

async function isInPlace({path: file, build}: ProgramTarget) {
  try {
    return (await sha256Of(file)) === build.sha256
  } catch {
    return false
  }
}

/**
 * Makes sure the exact build named in the manifest is at `path`, downloading
 * it if not. The download goes beside it first and is moved into place only
 * once its size and hash match; anything else throws and leaves nothing
 * behind. Yields the download's progress.
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

    await fs.rm(target.path, {force: true})
    await fs.rename(partial, target.path)
  } finally {
    await fs.rm(partial, {force: true})
  }
}
