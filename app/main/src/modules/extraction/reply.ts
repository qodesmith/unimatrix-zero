import type {ExtractionFormat, ExtractorReply} from '@uz/contract/extraction'

import {
  EXTRACTED_TEXT_LIMIT,
  ExtractorReplySchema,
  PAGE_IMAGES_PER_PDF,
  PAGE_IMAGE_PIXELS,
  PAGE_IMAGE_SIZE_LIMIT,
} from '@uz/contract/extraction'

import {extractionCandidate, formatFits} from './candidate'
import {jpegSize} from './jpeg'

type PageImage = Extract<ExtractorReply, {type: 'read'}>['pageImages'][number]

/** A reply that passed every check; anything else is a failure. */
export type ExtractionResult =
  | {
      type: 'read'
      format: ExtractionFormat
      text: string
      pageImages: PageImage[]
      imagesStopped: boolean
    }
  | {type: 'unsupported'}
  | {type: 'failed'}

type ReadReply = Extract<ExtractorReply, {type: 'read'}>

const FAILED = {type: 'failed'} as const

function decodedText(bytes: Uint8Array) {
  if (bytes.byteLength > EXTRACTED_TEXT_LIMIT) return null

  try {
    return new TextDecoder('utf-8', {fatal: true}).decode(bytes)
  } catch {
    return null
  }
}

function isPageImage(bytes: Uint8Array) {
  if (bytes.byteLength > PAGE_IMAGE_SIZE_LIMIT) return false

  const size = jpegSize(bytes)

  return (
    size !== null &&
    Math.min(size.width, size.height) >= 1 &&
    Math.max(size.width, size.height) <= PAGE_IMAGE_PIXELS
  )
}

function inPageOrder(images: readonly PageImage[]) {
  return images.every(
    (image, at) => at === 0 || image.page > (images[at - 1]?.page ?? 0)
  )
}

function pageImagesFit(reply: ReadReply) {
  if (reply.format !== 'pdf') {
    return reply.pageImages.length === 0 && !reply.imagesStopped
  }

  return (
    reply.pageImages.length <= PAGE_IMAGES_PER_PDF &&
    inPageOrder(reply.pageImages) &&
    reply.pageImages.every(({bytes}) => isPageImage(bytes))
  )
}

function validRead(reply: ReadReply, input: Uint8Array): ExtractionResult {
  if (!formatFits(reply.format, input) || !pageImagesFit(reply)) return FAILED

  const text = decodedText(reply.text)

  return text === null
    ? FAILED
    : {
        type: 'read',
        format: reply.format,
        text,
        pageImages: reply.pageImages,
        imagesStopped: reply.imagesStopped,
      }
}

/**
 * The window is hostile: anything off in its reply discards the whole of it.
 * `input` is the file the job was given.
 */
/** Only a zip or a notebook can be a file of none of the formats. */
function mayBeUnsupported(input: Uint8Array) {
  const candidate = extractionCandidate(input)

  return candidate === 'zip' || candidate === 'ipynb'
}

export function validateReply(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the window's message: ExtractorReplySchema parses it below
  data: unknown,
  input: Uint8Array
): ExtractionResult {
  const parsed = ExtractorReplySchema.safeParse(data)

  if (!parsed.success) return FAILED

  const reply = parsed.data

  switch (reply.type) {
    case 'read':
      return validRead(reply, input)
    case 'unsupported':
      return mayBeUnsupported(input) ? {type: 'unsupported'} : FAILED
    case 'failed':
      return FAILED
    default:
      throw new Error('Unknown extractor reply.')
  }
}
