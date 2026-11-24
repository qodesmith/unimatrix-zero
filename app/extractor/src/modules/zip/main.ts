import {MIB} from '@uz/contract/sizes'
import {Inflate} from 'fflate'

/** `ratio` is expanded bytes over compressed bytes. */
const ZIP_LIMITS = {entries: 2048, expandedBytes: 32 * MIB, ratio: 200}

const LOCAL_HEADER = 0x04_03_4b_50
const CENTRAL_HEADER = 0x02_01_4b_50
const END_OF_DIRECTORY = 0x06_05_4b_50
const ZIP64_LOCATOR = 0x07_06_4b_50
const END_RECORD_SIZE = 22
const LONGEST_COMMENT = 0xff_ff
const FLAG_ENCRYPTED = 1
const FLAG_STRONG_ENCRYPTION = 0x40
const STORED = 0
const DEFLATE = 8
const ZIP64_MARK = 0xff_ff_ff_ff

/** Small enough that one push of a bomb's input inflates a few MiB at most. */
const INFLATE_CHUNK = 4096

interface Entry {
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

export interface Zip {
  has: (name: string) => boolean
  names: () => string[]
  /** The entry's bytes, or null when the archive has no such entry. */
  read: (name: string) => Uint8Array | null
}

export function isZip(bytes: Uint8Array) {
  return bytes.length >= 4 && view(bytes).getUint32(0, true) === LOCAL_HEADER
}

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function findEndRecord(data: DataView) {
  const last = data.byteLength - END_RECORD_SIZE
  const first = Math.max(0, last - LONGEST_COMMENT)

  for (let at = last; at >= first; at--)
    if (data.getUint32(at, true) === END_OF_DIRECTORY) return at

  throw new Error('The zip has no central directory.')
}

function readEndRecord(data: DataView) {
  const at = findEndRecord(data)
  const count = data.getUint16(at + 10, true)
  const directorySize = data.getUint32(at + 12, true)
  const directoryOffset = data.getUint32(at + 16, true)

  const zip64 =
    (at >= 20 && data.getUint32(at - 20, true) === ZIP64_LOCATOR) ||
    count === 0xff_ff ||
    directorySize === ZIP64_MARK ||
    directoryOffset === ZIP64_MARK

  if (zip64) throw new Error('The zip is a zip64 archive.')

  if (count > ZIP_LIMITS.entries)
    throw new Error(`The zip has more than ${ZIP_LIMITS.entries} entries.`)

  return {count, directoryOffset}
}

function checkEntry(entry: Entry, flags: number) {
  // oxlint-disable-next-line no-bitwise -- a zip entry's flags are a bit field
  if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION))
    throw new Error('The zip is encrypted.')

  if (entry.method !== STORED && entry.method !== DEFLATE)
    throw new Error(`The zip uses compression method ${entry.method}.`)

  if (entry.compressedSize === ZIP64_MARK || entry.size === ZIP64_MARK)
    throw new Error('The zip is a zip64 archive.')

  if (entry.size / Math.max(entry.compressedSize, 1) > ZIP_LIMITS.ratio)
    throw new Error(`A zip entry expands more than ${ZIP_LIMITS.ratio}×.`)
}

function readDirectory(bytes: Uint8Array) {
  const data = view(bytes)
  const {count, directoryOffset} = readEndRecord(data)
  const decoder = new TextDecoder()
  const entries = new Map<string, Entry>()
  let at = directoryOffset
  let expanded = 0

  for (let index = 0; index < count; index++) {
    if (data.getUint32(at, true) !== CENTRAL_HEADER)
      throw new Error('The zip directory is damaged.')
    const nameLength = data.getUint16(at + 28, true)
    const skip = data.getUint16(at + 30, true) + data.getUint16(at + 32, true)

    const entry = {
      method: data.getUint16(at + 10, true),
      compressedSize: data.getUint32(at + 20, true),
      size: data.getUint32(at + 24, true),
      localOffset: data.getUint32(at + 42, true),
    }

    checkEntry(entry, data.getUint16(at + 8, true))
    expanded += entry.size

    if (expanded > ZIP_LIMITS.expandedBytes)
      throw new Error('The zip expands past the size limit.')
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))

    if (!entries.has(name)) entries.set(name, entry)
    at += 46 + nameLength + skip
  }

  return entries
}

function entryData(bytes: Uint8Array, entry: Entry) {
  const data = view(bytes)
  const at = entry.localOffset

  if (data.getUint32(at, true) !== LOCAL_HEADER)
    throw new Error('A zip entry is damaged.')

  const start =
    at + 30 + data.getUint16(at + 26, true) + data.getUint16(at + 28, true)

  const end = start + entry.compressedSize

  if (end > bytes.length) throw new Error('A zip entry runs past the end.')

  return bytes.subarray(start, end)
}

/**
 * Opens a zip within `ZIP_LIMITS`: the directory is checked up front, and
 * each read counts the bytes it really inflates, so lying headers stop too.
 */
export function openZip(bytes: Uint8Array): Zip {
  const entries = readDirectory(bytes)
  const cache = new Map<string, Uint8Array>()
  const budget = {expanded: 0}

  function read(name: string) {
    const cached = cache.get(name)

    if (cached) return cached
    const entry = entries.get(name)

    if (!entry) return null
    const output = inflateEntry(entryData(bytes, entry), entry, budget)

    cache.set(name, output)

    return output
  }

  return {
    has: name => entries.has(name),
    names: () => [...entries.keys()],
    read,
  }
}

function inflateEntry(
  input: Uint8Array,
  entry: Entry,
  budget: {expanded: number}
) {
  if (entry.method === STORED) {
    if (entry.size !== input.length)
      throw new Error('A zip entry is not the size it declares.')
    spend(budget, input.length)

    return input
  }

  const chunks: Uint8Array[] = []
  let produced = 0

  const inflate = new Inflate(chunk => {
    produced += chunk.length

    if (produced > entry.size)
      throw new Error('A zip entry expands past the size it declares.')

    if (produced / Math.max(input.length, 1) > ZIP_LIMITS.ratio)
      throw new Error(`A zip entry expands more than ${ZIP_LIMITS.ratio}×.`)
    spend(budget, chunk.length)
    chunks.push(chunk)
  })

  for (let at = 0; at < input.length; at += INFLATE_CHUNK)
    inflate.push(
      input.subarray(at, at + INFLATE_CHUNK),
      at + INFLATE_CHUNK >= input.length
    )

  if (input.length === 0) inflate.push(input, true)

  if (produced !== entry.size)
    throw new Error('A zip entry is not the size it declares.')

  return join(chunks, produced)
}

/** An entry name for a relative link from a part in `folder`, like `xl/`. */
export function resolveEntry(folder: string, target: string) {
  const path = target.startsWith('/') ? target.slice(1) : folder + target
  const parts: string[] = []

  for (const part of path.split('/'))
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)

  return parts.join('/')
}

function spend(budget: {expanded: number}, bytes: number) {
  budget.expanded += bytes

  if (budget.expanded > ZIP_LIMITS.expandedBytes)
    throw new Error('The zip expands past the size limit.')
}

function join(chunks: Uint8Array[], length: number) {
  if (chunks.length === 1 && chunks[0]) return chunks[0]
  const output = new Uint8Array(length)
  let at = 0

  for (const chunk of chunks) {
    output.set(chunk, at)
    at += chunk.length
  }

  return output
}
