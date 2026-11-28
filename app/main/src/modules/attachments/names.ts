import type {AttachmentMediaType} from '@uz/contract/attachments'

import path from 'node:path'

const FALLBACK_NAMES = {
  'image/png': 'Pasted image.png',
  'image/jpeg': 'Pasted image.jpg',
  'image/gif': 'Pasted image.gif',
  'image/webp': 'Pasted image.webp',
  'application/pdf': 'Pasted PDF.pdf',
  'text/plain': 'Pasted text.txt',
  'application/octet-stream': 'Pasted file',
  'inode/directory': 'Folder',
} satisfies Record<AttachmentMediaType, string>

const NAME_BYTES = 255

const EXTENSION_BYTES = 32

const CONTROL_CHARACTERS = /\p{Cc}/gu

function byteLength(text: string) {
  return Buffer.byteLength(text, 'utf8')
}

function capped(name: string) {
  if (byteLength(name) <= NAME_BYTES) return name

  const found = path.extname(name)
  const extension = byteLength(found) <= EXTENSION_BYTES ? found : ''
  const room = NAME_BYTES - byteLength(extension)
  let stem = ''

  for (const character of name.slice(0, name.length - extension.length)) {
    if (byteLength(stem + character) > room) break

    stem += character
  }

  return stem.trimEnd() + extension
}

export function safeName(raw: string, mediaType: AttachmentMediaType) {
  // Both separators on every platform: a pasted name can come from any.
  const name = path.win32
    .basename(raw.trim())
    .replaceAll(CONTROL_CHARACTERS, '')
    .trim()

  return name === '' || name === '.' || name === '..'
    ? FALLBACK_NAMES[mediaType]
    : capped(name)
}
