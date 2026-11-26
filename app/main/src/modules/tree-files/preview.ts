import type {TreeFilePreview} from '@uz/contract/tree-files'

import {PREVIEW_SIZE_LIMIT} from '@uz/contract/tree-files'
import path from 'node:path'

/** How much of a file decides its preview. */
export const SAMPLE_BYTES = 8 * 1024

const MEDIA_TYPES = new Map<string, ['image' | 'audio' | 'video', string]>([
  ['png', ['image', 'image/png']],
  ['jpg', ['image', 'image/jpeg']],
  ['jpeg', ['image', 'image/jpeg']],
  ['gif', ['image', 'image/gif']],
  ['webp', ['image', 'image/webp']],
  ['avif', ['image', 'image/avif']],
  ['bmp', ['image', 'image/bmp']],
  ['ico', ['image', 'image/x-icon']],
  ['svg', ['image', 'image/svg+xml']],
  ['mp3', ['audio', 'audio/mpeg']],
  ['m4a', ['audio', 'audio/mp4']],
  ['aac', ['audio', 'audio/aac']],
  ['wav', ['audio', 'audio/wav']],
  ['ogg', ['audio', 'audio/ogg']],
  ['oga', ['audio', 'audio/ogg']],
  ['opus', ['audio', 'audio/ogg']],
  ['flac', ['audio', 'audio/flac']],
  ['mp4', ['video', 'video/mp4']],
  ['m4v', ['video', 'video/mp4']],
  ['webm', ['video', 'video/webm']],
  ['mov', ['video', 'video/quicktime']],
  ['ogv', ['video', 'video/ogg']],
])

const TEXT_KINDS = new Map<string, TreeFilePreview>([
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['csv', 'csv'],
  ['tsv', 'csv'],
  ['html', 'html'],
  ['htm', 'html'],
])

const LINK_MODE = '120000'
const PROGRAM_MODE = '100755'

const PDF_MAGIC = '%PDF-'

function extensionOf(name: string) {
  return path.posix.extname(name).slice(1).toLowerCase()
}

/** The image, audio or video type the name gives, or null. */
export function mediaTypeOf(name: string) {
  return MEDIA_TYPES.get(extensionOf(name))?.[1] ?? null
}

/** `whole` when the sample holds every byte, so none is cut off at its end. */
function isText(sample: Buffer, whole: boolean) {
  if (sample.includes(0)) return false

  try {
    new TextDecoder('utf-8', {fatal: true}).decode(sample, {stream: !whole})

    return true
  } catch {
    return false
  }
}

function kindOf(name: string, sample: Buffer, size: number) {
  if (sample.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC) {
    return 'pdf'
  }

  const extension = extensionOf(name)
  const media = MEDIA_TYPES.get(extension)?.[0]

  if (!isText(sample, sample.byteLength >= size)) return media ?? 'other'

  // An SVG is text, and runs only as an image.
  if (extension === 'svg') return 'image'

  return TEXT_KINDS.get(extension) ?? 'text'
}

function overLimit(preview: TreeFilePreview, size: number) {
  const limits: Partial<Record<TreeFilePreview, number>> = PREVIEW_SIZE_LIMIT
  const limit = limits[preview]

  return limit !== undefined && size > limit
}

/** Decided from the bytes, and the name only among text or media types. */
export function previewOf({
  name,
  mode,
  size,
  sample,
}: {
  name: string
  mode: string
  size: number
  sample: Buffer
}) {
  const link = mode === LINK_MODE
  const preview: TreeFilePreview = link ? 'other' : kindOf(name, sample, size)

  return {
    preview,
    tooLarge: overLimit(preview, size),
    executable: mode === PROGRAM_MODE,
    link,
  }
}

export function isLinkMode(mode: string) {
  return mode === LINK_MODE
}
