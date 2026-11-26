import type {GitBlobs} from './git'

import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const LINK_REFUSED =
  'That file is a link, which Unimatrix Zero never follows.'

const OUTSIDE_REFUSED =
  'That file leads outside the Tree’s folder, so Unimatrix Zero won’t open it.'

const GONE = 'That file is no longer in the Tree’s folder.'

/**
 * The file at `filePath` in the Tree's folder, refused when it is a link or
 * leads outside the folder by any link on the way: the AI can make links.
 */
export function inTreeFolder(folder: string, filePath: string) {
  const root = fs.realpathSync(folder)
  const file = path.join(folder, ...filePath.split('/'))
  let real: string

  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(LINK_REFUSED)

    real = fs.realpathSync(file)
  } catch (error) {
    const missing =
      error instanceof Error && 'code' in error && error.code === 'ENOENT'

    throw missing ? new Error(GONE) : error
  }

  if (!real.startsWith(`${root}${path.sep}`)) throw new Error(OUTSIDE_REFUSED)

  const stat = fs.statSync(real)

  if (!stat.isFile()) throw new Error(GONE)

  return {file: real, stat}
}

/** Any of its execute bits; Windows keeps none. */
export function hasExecuteBit(stat: fs.Stats) {
  // oxlint-disable-next-line no-bitwise -- the mode's execute bits
  return process.platform !== 'win32' && (stat.mode & 0o111) !== 0
}

/**
 * Read-only copies of Snapshot files, named as the file so the app that
 * opens one knows its type. A folder per blob holds the same bytes under
 * every name.
 */
export function createCopies(tempDir: string, blobs: () => GitBlobs) {
  const copying = new Map<string, Promise<string>>()

  async function write(store: string, blob: string, copy: string) {
    fs.mkdirSync(path.dirname(copy), {recursive: true, mode: 0o700})

    const part = path.join(path.dirname(copy), `.${randomUUID()}.part`)

    try {
      await blobs().write(store, blob, part)
      fs.chmodSync(part, 0o444)
      fs.renameSync(part, copy)
    } finally {
      fs.rmSync(part, {force: true})
    }

    return copy
  }

  return {
    async copyOf(store: string, blob: string, filePath: string) {
      const copy = path.join(tempDir, blob, path.posix.basename(filePath))

      if (fs.lstatSync(copy, {throwIfNoEntry: false})?.isFile()) return copy

      fs.rmSync(copy, {recursive: true, force: true})

      const pending = copying.get(copy) ?? write(store, blob, copy)
      copying.set(copy, pending)

      try {
        return await pending
      } finally {
        copying.delete(copy)
      }
    },
  }
}

/** Run at launch: nothing else uses the copies of an earlier run. */
export function clearCopies(tempDir: string) {
  if (!fs.existsSync(tempDir)) return

  for (const entry of fs.readdirSync(tempDir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      fs.chmodSync(path.join(entry.parentPath, entry.name), 0o600)
    }
  }

  fs.rmSync(tempDir, {recursive: true, force: true})
}
