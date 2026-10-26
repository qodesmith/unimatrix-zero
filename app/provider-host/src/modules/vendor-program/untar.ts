import {createReadStream} from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {createGunzip} from 'node:zlib'

const BLOCK = 512

/** Reads a stream by exact sizes, however its chunks fall. */
function byteReader(source: AsyncIterable<Buffer>) {
  const chunks = source[Symbol.asyncIterator]()
  let buffered = Buffer.alloc(0)

  async function fill() {
    const step = await chunks.next()

    if (step.done) return false

    buffered = Buffer.concat([buffered, step.value])

    return true
  }

  return {
    /** Exactly `size` bytes; null when the stream ends first. */
    async read(size: number) {
      while (buffered.length < size) {
        if (!(await fill())) return null
      }

      const bytes = buffered.subarray(0, size)
      buffered = buffered.subarray(size)

      return bytes
    },

    /** Exactly `size` bytes; throws when the stream ends first. */
    async exactly(size: number) {
      const bytes = await this.read(size)

      if (!bytes) throw new Error('The archive ends early.')

      return bytes
    },

    async *pieces(size: number) {
      let left = size

      while (left > 0) {
        if (buffered.length === 0 && !(await fill())) {
          throw new Error('The archive ends early.')
        }

        const piece = buffered.subarray(0, left)
        buffered = buffered.subarray(piece.length)
        left -= piece.length

        yield piece
      }
    },
  }
}

function text(header: Buffer, start: number, length: number) {
  const field = header.subarray(start, start + length)
  const end = field.indexOf(0)

  return field.subarray(0, end === -1 ? length : end).toString('utf8')
}

function octal(header: Buffer, start: number, length: number) {
  return Number.parseInt(text(header, start, length).trim() || '0', 8)
}

/** The `path` a pax extended header gives the entry after it, if any. */
function paxPath(records: Buffer) {
  for (const line of records.toString('utf8').split('\n')) {
    const match = /^\d+ path=(.*)$/s.exec(line)

    if (match?.[1]) return match[1]
  }

  return null
}

async function writeFile(
  reader: ReturnType<typeof byteReader>,
  target: string,
  mode: number,
  size: number
) {
  await fs.mkdir(path.dirname(target), {recursive: true})
  const file = await fs.open(target, 'w', mode)

  try {
    for await (const piece of reader.pieces(size)) await file.write(piece)
  } finally {
    await file.close()
  }
}

/** `name` resolved in `folder`; throws when it would land outside it. */
function inside(folder: string, name: string) {
  const target = path.resolve(folder, name)

  const within = target === folder || target.startsWith(`${folder}${path.sep}`)

  if (path.isAbsolute(name) || !within) {
    throw new Error(`The archive has a path outside its folder: ${name}`)
  }

  return target
}

/**
 * Keeps each file's permission bits. Anything but files, folders and pax
 * headers, or a path outside `folder`, throws.
 */
export async function untar(
  archive: string,
  folder: string,
  signal: AbortSignal
) {
  const reader = byteReader(createReadStream(archive).pipe(createGunzip()))
  let nextPath: string | null = null

  await fs.mkdir(folder, {recursive: true})

  for (;;) {
    signal.throwIfAborted()

    const header = await reader.read(BLOCK)

    if (!header || header.every(byte => byte === 0)) return

    const size = octal(header, 124, 12)
    const type = text(header, 156, 1)
    const padding = (BLOCK - (size % BLOCK)) % BLOCK
    const prefix = text(header, 345, 155)
    const name = nextPath ?? (prefix ? `${prefix}/` : '') + text(header, 0, 100)
    nextPath = null

    if (type === 'x' || type === 'g') {
      const records = await reader.exactly(size + padding)

      if (type === 'x') nextPath = paxPath(records.subarray(0, size))

      continue
    }

    const target = inside(folder, name)

    if (type === '5') {
      await fs.mkdir(target, {recursive: true})
    } else if (type === '0' || type === '') {
      // The permission bits, without set-user-ID and the like.
      await writeFile(reader, target, octal(header, 100, 8) % 0o1000, size)
      await reader.exactly(padding)
    } else {
      throw new Error(`The archive has an entry it can't unpack: ${name}`)
    }
  }
}
