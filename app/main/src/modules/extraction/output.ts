import type {ExtractorOutput} from '@uz/contract/extraction'

import {
  EXTRACTED_TEXT_LIMIT,
  ExtractorOutputSchema,
  PAGE_IMAGES_PER_PDF,
  PAGE_IMAGE_PIXELS,
} from '@uz/contract/extraction'
import {MIB} from '@uz/contract/sizes'

import {extractionCandidate, formatFits} from './candidate'
import {jpegSize} from './jpeg'

type ReadOutput = Extract<ExtractorOutput, {type: 'read'}>

/** Output that passed every check; anything else is a failure. */
export type ExtractionResult =
  | (Omit<ReadOutput, 'text'> & {text: string})
  | Extract<ExtractorOutput, {type: 'unsupported'}>
  | {type: 'failed'}

export const PAGE_IMAGE_SIZE_LIMIT = 8 * MIB

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

function inPageOrder(images: ReadOutput['pageImages']) {
  return images.every(
    (image, at) => at === 0 || image.page > (images[at - 1]?.page ?? 0)
  )
}

function pageImagesFit(output: ReadOutput) {
  if (output.format !== 'pdf') {
    return output.pageImages.length === 0 && !output.imagesStopped
  }

  return (
    output.pageImages.length <= PAGE_IMAGES_PER_PDF &&
    (!output.imagesStopped ||
      output.pageImages.length === PAGE_IMAGES_PER_PDF) &&
    inPageOrder(output.pageImages) &&
    output.pageImages.every(({bytes}) => isPageImage(bytes))
  )
}

function validRead(output: ReadOutput, input: Uint8Array): ExtractionResult {
  if (!formatFits(output.format, input) || !pageImagesFit(output)) return FAILED

  const text = decodedText(output.text)

  return text === null
    ? FAILED
    : {
        type: 'read',
        format: output.format,
        text,
        pageImages: output.pageImages,
        imagesStopped: output.imagesStopped,
      }
}

/** Only a zip or a notebook can be a file of none of the formats. */
function mayBeUnsupported(input: Uint8Array) {
  const candidate = extractionCandidate(input)

  return candidate === 'zip' || candidate === 'ipynb'
}

/**
 * The window is hostile: anything off in its output discards all of it.
 * `input` is the file the job was given.
 */
export function validateOutput(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the window's message: ExtractorOutputSchema parses it below
  data: unknown,
  input: Uint8Array
): ExtractionResult {
  const parsed = ExtractorOutputSchema.safeParse(data)

  if (!parsed.success) return FAILED

  const output = parsed.data

  switch (output.type) {
    case 'read':
      return validRead(output, input)
    case 'unsupported':
      return mayBeUnsupported(input) ? {type: 'unsupported'} : FAILED
    case 'failed':
      return FAILED
    default:
      throw new Error('Unknown extractor output.')
  }
}
