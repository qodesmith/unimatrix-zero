import {MIB} from '#modules/sizes/main'
import {z} from 'zod'

/** Raise it when the extractor's output changes: older Extractions are redone. */
export const EXTRACTOR_VERSION = 1

/** The attachment limit: a larger file is never extracted. */
export const EXTRACTION_INPUT_LIMIT = 50 * MIB

export const EXTRACTION_TIMEOUT_MS = 60_000

/** Pixels, on the long side. */
export const PAGE_IMAGE_PIXELS = 1600

export const PAGE_IMAGE_QUALITY = 0.85

export const PAGE_IMAGES_PER_PDF = 100

/** A page gets an image when its images cover more than this share of it. */
export const PAGE_IMAGE_COVERAGE = 0.1

export const PAGE_IMAGE_SIZE_LIMIT = 8 * MIB

export const EXTRACTED_TEXT_LIMIT = 32 * MIB

/** T3 Code's: `ratio` is expanded bytes over compressed bytes. */
export const ZIP_LIMITS = {entries: 2048, expandedBytes: 32 * MIB, ratio: 200}

export const ExtractionFormatSchema = z.enum([
  'pdf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'rtf',
  'epub',
  'ipynb',
])

export type ExtractionFormat = z.infer<typeof ExtractionFormatSchema>

/** The job main posts to the extraction window: the file's bytes alone. */
export interface ExtractionJob {
  bytes: Uint8Array
}

/**
 * What the extraction window posts back. It is hostile: main parses it with
 * this schema and then checks each image's bytes and the text's encoding.
 */
export const ExtractorReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('read'),
    format: ExtractionFormatSchema,
    /** UTF-8. A PDF's has a heading per page, an office file's per part. */
    text: z.instanceof(Uint8Array),
    /** JPEGs, a PDF's alone, in page order. */
    pageImages: z.array(
      z.strictObject({
        page: z.number().int().positive(),
        bytes: z.instanceof(Uint8Array),
      })
    ),
    /** More pages than `PAGE_IMAGES_PER_PDF` called for an image. */
    imagesStopped: z.boolean(),
  }),
  /** Not one of the formats: the file goes by path only, with no word. */
  z.strictObject({type: z.literal('unsupported')}),
  z.strictObject({type: z.literal('failed'), message: z.string().max(1000)}),
])

export type ExtractorReply = z.infer<typeof ExtractorReplySchema>

/** What main keeps of an Extraction, and what the renderer sees of it. */
export const ExtractionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('read'),
    version: z.number().int().positive(),
    /** Whether a text file was written: a scan may have no text at all. */
    text: z.boolean(),
    /** The pages that have an image, in order. */
    pageImages: z.array(z.number().int().positive()),
    imagesStopped: z.boolean(),
  }),
  z.strictObject({
    status: z.literal('failed'),
    version: z.number().int().positive(),
  }),
])

export type Extraction = z.infer<typeof ExtractionSchema>
