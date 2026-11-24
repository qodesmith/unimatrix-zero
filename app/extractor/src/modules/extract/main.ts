import type {OdfKind} from '#modules/odf/main'
import type {PdfAssets, PdfReading} from '#modules/pdf/main'
import type {ExtractionFormat, ExtractorReply} from '@uz/contract/extraction'

import {readDocx} from '#modules/docx/main'
import {readEpub} from '#modules/epub/main'
import {parseNotebook, readNotebook} from '#modules/ipynb/main'
import {readOdf} from '#modules/odf/main'
import {readPdf} from '#modules/pdf/main'
import {readPptx} from '#modules/pptx/main'
import {isRtf, readRtf} from '#modules/rtf/main'
import {readXlsx} from '#modules/xlsx/main'
import {isZip, openZip} from '#modules/zip/main'
import {EXTRACTED_TEXT_LIMIT} from '@uz/contract/extraction'

const MESSAGE_LIMIT = 1000
const PDF_SIGNATURE = '%PDF-'

const MIME_TYPES = new Map<string, OdfKind>([
  ['application/vnd.oasis.opendocument.text', 'odt'],
  ['application/vnd.oasis.opendocument.spreadsheet', 'ods'],
  ['application/vnd.oasis.opendocument.presentation', 'odp'],
])

function isPdf(bytes: Uint8Array) {
  return (
    new TextDecoder().decode(bytes.subarray(0, PDF_SIGNATURE.length)) ===
    PDF_SIGNATURE
  )
}

function readText(
  format: ExtractionFormat,
  text: string,
  pdf?: Omit<PdfReading, 'text'>
): ExtractorReply {
  const encoded = new TextEncoder().encode(text)

  if (encoded.length > EXTRACTED_TEXT_LIMIT)
    throw new Error('The text is past the size limit.')

  return {
    type: 'read',
    format,
    text: encoded,
    pageImages: pdf?.pageImages ?? [],
    imagesStopped: pdf?.imagesStopped ?? false,
  }
}

function extractZip(bytes: Uint8Array): ExtractorReply {
  const zip = openZip(bytes)
  const mimetype = zip.read('mimetype')
  const declared = mimetype && new TextDecoder().decode(mimetype).trim()
  const odf = declared && MIME_TYPES.get(declared)

  if (odf) return readText(odf, readOdf(zip, odf))

  if (declared === 'application/epub+zip')
    return readText('epub', readEpub(zip))

  if (zip.has('word/document.xml')) return readText('docx', readDocx(zip))

  if (zip.has('xl/workbook.xml')) return readText('xlsx', readXlsx(zip))

  if (zip.has('ppt/presentation.xml')) return readText('pptx', readPptx(zip))

  return {type: 'unsupported'}
}

async function extractAny(
  bytes: Uint8Array,
  assets: PdfAssets | undefined
): Promise<ExtractorReply> {
  if (isPdf(bytes)) {
    const {text, ...images} = await readPdf(bytes, assets)

    return readText('pdf', text, images)
  }

  if (isZip(bytes)) return extractZip(bytes)

  if (isRtf(bytes)) return readText('rtf', readRtf(bytes))
  const notebook = parseNotebook(bytes)

  if (notebook) return readText('ipynb', readNotebook(notebook))

  return {type: 'unsupported'}
}

/**
 * Tells the format apart by its bytes alone, never a name, and reads it.
 * It never throws: an error is a `failed` reply.
 */
export async function extract(
  bytes: Uint8Array,
  assets?: PdfAssets
): Promise<ExtractorReply> {
  try {
    return await extractAny(bytes, assets)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    return {type: 'failed', message: message.slice(0, MESSAGE_LIMIT)}
  }
}
