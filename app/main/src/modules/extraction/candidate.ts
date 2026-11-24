import type {ExtractionFormat} from '@uz/contract/extraction'

/** What main can tell from the bytes; the window tells the formats apart. */
export type Candidate = 'pdf' | 'zip' | 'rtf' | 'ipynb'

const CANDIDATE_OF = {
  pdf: 'pdf',
  docx: 'zip',
  xlsx: 'zip',
  pptx: 'zip',
  odt: 'zip',
  ods: 'zip',
  odp: 'zip',
  epub: 'zip',
  rtf: 'rtf',
  ipynb: 'ipynb',
} as const satisfies Record<ExtractionFormat, Candidate>

const encoder = new TextEncoder()

const PREFIXES: [Candidate, Uint8Array][] = [
  ['pdf', encoder.encode('%PDF-')],
  ['zip', Uint8Array.from([0x50, 0x4b, 0x03, 0x04])],
  ['rtf', encoder.encode(String.raw`{\rtf`)],
]

const NBFORMAT = Buffer.from('"nbformat"')

const OPEN_BRACE = 0x7b

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d])

function startsWith(bytes: Uint8Array, prefix: Uint8Array) {
  return prefix.every((byte, at) => bytes[at] === byte)
}

function isText(bytes: Uint8Array) {
  if (bytes.includes(0)) return false

  try {
    new TextDecoder('utf-8', {fatal: true}).decode(bytes)

    return true
  } catch {
    return false
  }
}

function isNotebook(bytes: Uint8Array) {
  const first = bytes.find(byte => !WHITESPACE.has(byte))

  return (
    first === OPEN_BRACE &&
    Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(
      NBFORMAT
    ) &&
    isText(bytes)
  )
}

/** Null when the bytes can't be any format the window reads. */
export function extractionCandidate(bytes: Uint8Array): Candidate | null {
  const signed = PREFIXES.find(([, prefix]) => startsWith(bytes, prefix))

  if (signed) return signed[0]

  return isNotebook(bytes) ? 'ipynb' : null
}

export function formatFits(format: ExtractionFormat, bytes: Uint8Array) {
  return CANDIDATE_OF[format] === extractionCandidate(bytes)
}
