import {randomUUID} from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Named by content alone, so every add of the same bytes shares it. */
export function originalPath(dir: string, sha256: string) {
  return path.join(dir, sha256)
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

/** Written under a temporary name and renamed, so no one sees half a file. */
export async function keepOriginal(
  dir: string,
  sha256: string,
  bytes: Uint8Array
) {
  const target = originalPath(dir, sha256)

  try {
    await fs.access(target)

    return
  } catch {
    // Not kept yet.
  }

  const temporary = path.join(dir, `.${sha256}.${randomUUID()}.tmp`)

  try {
    await fs.writeFile(temporary, bytes, {mode: 0o600, flag: 'wx'})
    await fs.rename(temporary, target)
  } finally {
    await fs.rm(temporary, {force: true})
  }
}
