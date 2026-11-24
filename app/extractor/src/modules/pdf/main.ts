import type {ExtractorReply} from '@uz/contract/extraction'
import type {PDFPageProxy} from 'pdfjs-dist'

import {PAGE_IMAGES_PER_PDF, PAGE_IMAGE_COVERAGE} from '@uz/contract/extraction'
import {GlobalWorkerOptions, getDocument} from 'pdfjs-dist'
// oxlint-disable-next-line import/default -- Vite's `?url` import is the URL of the worker, emitted as its own file
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import {imageCoverage} from './coverage'
import {renderPage} from './page-image'

GlobalWorkerOptions.workerSrc = workerUrl

/** Where pdf.js finds the files it fetches: each URL ends in a slash. */
export interface PdfAssets {
  cMapUrl: string
  iccUrl: string
  standardFontDataUrl: string
  wasmUrl: string
}

type Read = Extract<ExtractorReply, {type: 'read'}>

export interface PdfReading {
  text: string
  pageImages: Read['pageImages']
  imagesStopped: boolean
}

/** The folders the build copies from `pdfjs-dist` into `dist/`. */
export function pdfAssetsAt(origin: string): PdfAssets {
  return {
    cMapUrl: `${origin}/cmaps/`,
    iccUrl: `${origin}/iccs/`,
    standardFontDataUrl: `${origin}/standard_fonts/`,
    wasmUrl: `${origin}/wasm/`,
  }
}

async function wantsImage(page: PDFPageProxy, text: string) {
  if (!text) return true

  return (
    imageCoverage(await page.getOperatorList(), page.view) > PAGE_IMAGE_COVERAGE
  )
}

async function pageText(page: PDFPageProxy) {
  const content = await page.getTextContent()
  let text = ''

  for (const item of content.items)
    if ('str' in item) text += item.hasEOL ? `${item.str}\n` : item.str

  return text.trimEnd()
}

export async function readPdf(
  bytes: Uint8Array,
  assets?: PdfAssets
): Promise<PdfReading> {
  const task = getDocument({
    // pdf.js transfers `data` to its worker, which would empty the caller's bytes.
    data: bytes.slice(),
    ...assets,
    cMapPacked: true,
    disableWorkerRendering: true,
  })

  try {
    const document = await task.promise
    const pages: string[] = []
    let anyText = false
    const reading: PdfReading = {text: '', pageImages: [], imagesStopped: false}

    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const text = await pageText(page)
      const heading = `--- Page ${number} ---`

      pages.push(text ? `${heading}\n${text}` : heading)
      anyText ||= text !== ''

      if (!reading.imagesStopped && (await wantsImage(page, text)))
        if (reading.pageImages.length < PAGE_IMAGES_PER_PDF)
          reading.pageImages.push({page: number, bytes: await renderPage(page)})
        else reading.imagesStopped = true
      page.cleanup()
    }

    // Headings alone would pass for text the AI could read.
    return {...reading, text: anyText ? pages.join('\n\n') : ''}
  } finally {
    await task.destroy()
  }
}
