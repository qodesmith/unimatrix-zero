import {MIB} from '#modules/sizes/main'
import {z} from 'zod'

/** Raise it when the extractor's output changes: older Extractions are redone. */
export const EXTRACTOR_VERSION = 1

export const PAGE_IMAGE_PIXELS = 1600

export const PAGE_IMAGES_PER_PDF = 100

export const EXTRACTED_TEXT_LIMIT = 32 * MIB

export const FAILURE_MESSAGE_LIMIT = 1000

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

/**
 * The window's preload posts this to the page with the job's `MessagePort`,
 * the page's only channel.
 */
export const EXTRACTION_PORT_MESSAGE = 'uz:extraction-port'

export const ExtractionJobSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array),
})

export type ExtractionJob = z.infer<typeof ExtractionJobSchema>

/**
 * What the extraction window posts back. It is hostile: main parses it with
 * this schema and then checks each image's bytes and the text's encoding.
 */
export const ExtractorOutputSchema = z.discriminatedUnion('type', [
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
  z.strictObject({
    type: z.literal('failed'),
    message: z.string().max(FAILURE_MESSAGE_LIMIT),
  }),
])

export type ExtractorOutput = z.infer<typeof ExtractorOutputSchema>

export const ExtractionSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('read'),
    version: z.number().int().positive(),
    text: z.boolean(),
    pageImages: z.array(z.number().int().positive()),
    imagesStopped: z.boolean(),
  }),
  z.strictObject({
    status: z.literal('failed'),
    version: z.number().int().positive(),
  }),
])

export type Extraction = z.infer<typeof ExtractionSchema>
