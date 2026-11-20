import type {AttachmentMediaType} from '@uz/contract/attachments'

const SIGNATURES: [AttachmentMediaType, number[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', ascii('GIF87a')],
  ['image/gif', ascii('GIF89a')],
  ['application/pdf', ascii('%PDF-')],
]

function ascii(text: string) {
  return Array.from(new TextEncoder().encode(text))
}

function startsWith(bytes: Uint8Array, prefix: number[], at = 0) {
  return prefix.every((byte, index) => bytes[at + index] === byte)
}

function isWebp(bytes: Uint8Array) {
  return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)
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

/** From the bytes alone: a name or the window can say anything. */
export function sniffMediaType(bytes: Uint8Array): AttachmentMediaType | null {
  const signed = SIGNATURES.find(([, prefix]) => startsWith(bytes, prefix))

  if (signed) return signed[0]

  if (isWebp(bytes)) return 'image/webp'

  return isText(bytes) ? 'text/plain' : null
}
