import type {ConvertedPage} from '#modules/pdf-conversion/main'
import type {ConvertPdf} from '#modules/prompt-content/main'
import type {HostAttachment} from '@uz/contract/attachments'

import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** A PNG's first four bytes, in base64. */
export const PNG_BASE64 = 'iVBORw=='

/** `%PDF-1`, in base64. */
export const PDF_BASE64 = 'JVBERi0x'

/** Two bytes, in base64, that a fake converter renders a page as. */
export const PAGE_IMAGE_BASE64 = 'AQI='

/** Originals as main keeps them, each named by its SHA-256. */
export function attachedFiles(folder: string) {
  function attach(
    name: string,
    mediaType: HostAttachment['mediaType'],
    bytes: Uint8Array,
    sha: string
  ): HostAttachment {
    const sha256 = sha.repeat(64)
    const file = path.join(folder, sha256)
    fs.writeFileSync(file, bytes)

    return {name, mediaType, sha256, path: file}
  }

  return {
    notes: attach(
      'notes.txt',
      'text/plain',
      Buffer.from('Buy milk.', 'utf8'),
      'a'
    ),
    chart: attach(
      'chart.png',
      'image/png',
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      'b'
    ),
    report: attach(
      'report.pdf',
      'application/pdf',
      Buffer.from('%PDF-1', 'ascii'),
      'c'
    ),
    /** Names an original no longer there. */
    gone: {
      name: 'gone.txt',
      mediaType: 'text/plain',
      sha256: 'd'.repeat(64),
      path: path.join(folder, 'd'.repeat(64)),
    } satisfies HostAttachment,
  }
}

function keep(
  folder: string,
  name: string,
  mediaType: HostAttachment['mediaType'],
  bytes: Uint8Array
): HostAttachment {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const file = path.join(folder, sha256)
  fs.writeFileSync(file, bytes)

  return {name, mediaType, sha256, path: file}
}

/** For a live check: a PNG a Model can read `word` in. */
export async function pngShowing(folder: string, word: string) {
  const {createCanvas} = await import('@napi-rs/canvas')
  const canvas = createCanvas(480, 160)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, 480, 160)
  context.fillStyle = '#000000'
  context.font = 'bold 72px sans-serif'
  context.fillText(word, 40, 110)

  return keep(folder, 'word.png', 'image/png', await canvas.encode('png'))
}

/** For a live check: a one-page PDF whose text says `sentence`. */
export function pdfSaying(folder: string, sentence: string) {
  const text = `BT /F1 24 Tf 72 700 Td (${sentence}) Tj ET`

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const [at, body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${at + 1} 0 obj\n${body}\nendobj\n`
  }

  const xref = pdf.length

  const entries = offsets.map(
    offset => `${String(offset).padStart(10, '0')} 00000 n \n`
  )

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return keep(folder, 'note.pdf', 'application/pdf', Buffer.from(pdf, 'latin1'))
}

/**
 * Converts every PDF to a page of text, then a page rendered as an image, and
 * keeps what it was asked to convert.
 */
export function fakeConverter() {
  const calls: {original: HostAttachment; conversionDir: string}[] = []

  async function convertPdf(
    original: HostAttachment,
    conversionDir: string
  ): Promise<ConvertedPage[]> {
    calls.push({original, conversionDir})

    return [
      {text: 'Sales rose.', image: null},
      {text: 'A chart.', image: Uint8Array.from([1, 2])},
    ]
  }

  return {convertPdf: convertPdf satisfies ConvertPdf, calls}
}
