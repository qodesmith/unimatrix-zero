import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type ShrunkMediaType = 'image/png' | 'image/jpeg'

const SHRUNK_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
} satisfies Record<ShrunkMediaType, string>

/**
 * The folder is named by content, so every add of the same bytes shares it;
 * the file by its own name, so the path the AI gets ends in it.
 */
export function originalPath(dir: string, sha256: string, name: string) {
  return path.join(dir, sha256, name)
}

export function shrunkPath(
  dir: string,
  sha256: string,
  mediaType: ShrunkMediaType
) {
  return path.join(dir, 'shrunk', `${sha256}.${SHRUNK_EXTENSIONS[mediaType]}`)
}

/** False for a path that can't be read, which the read then reports. */
export async function isFolder(filePath: string) {
  try {
    const stats = await fs.stat(filePath)

    return stats.isDirectory()
  } catch {
    return false
  }
}

/**
 * Reads one byte past the limit at most, so a file too large is refused
 * without reading it whole.
 */
export async function readDropped(filePath: string, limit: number) {
  const name = path.basename(filePath).trim()

  try {
    await using handle = await fs.open(filePath, 'r')
    const buffer = new Uint8Array(limit + 1)
    let read = 0

    while (read < buffer.byteLength) {
      const {bytesRead} = await handle.read(buffer, read)

      if (bytesRead === 0) break

      read += bytesRead
    }

    return {name, bytes: buffer.subarray(0, read)}
  } catch {
    throw new Error(`Unimatrix Zero couldn’t read ${name}.`)
  }
}

async function exists(target: string) {
  try {
    await fs.access(target)

    return true
  } catch {
    return false
  }
}

/** Written under a temporary name and renamed, so no one sees half a file. */
async function writeWhole(dir: string, target: string, bytes: Uint8Array) {
  const temporary = path.join(dir, `.${randomUUID()}.tmp`)

  try {
    await fs.writeFile(temporary, bytes, {mode: 0o600, flag: 'wx'})
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, {force: true})
  }
}

/** A second name for bytes already kept, sharing them where it can. */
async function linkToKept(folder: string, target: string) {
  const [kept] = await fs.readdir(folder)

  if (kept === undefined) return false

  try {
    await fs.link(path.join(folder, kept), target)

    return true
  } catch {
    return exists(target)
  }
}

export async function keepOriginal(
  dir: string,
  original: {sha256: string; name: string},
  bytes: Uint8Array
) {
  const target = originalPath(dir, original.sha256, original.name)

  if (await exists(target)) return

  const folder = path.dirname(target)
  await fs.mkdir(folder, {recursive: true, mode: 0o700})

  if (await linkToKept(folder, target)) return

  await writeWhole(dir, target, bytes)
}

export async function keepShrunk(
  dir: string,
  shrunk: {sha256: string; mediaType: ShrunkMediaType},
  bytes: Uint8Array
) {
  const target = shrunkPath(dir, shrunk.sha256, shrunk.mediaType)

  if (await exists(target)) return

  await fs.mkdir(path.dirname(target), {recursive: true, mode: 0o700})
  await writeWhole(dir, target, bytes)
}
