import type {ConvertedPage} from './main'
import type {OPS as Ops, PDFPageProxy} from 'pdfjs-dist'

import {imageCoverage} from './coverage'
import {loadPdfjs, pdfjsAssets} from './pdfjs'
import {renderPage} from './render'

type Pdfjs = Awaited<ReturnType<typeof loadPdfjs>>

/** A page whose images cover more than this share of it is also rendered. */
const IMAGE_SHARE = 0.1

async function textOf(page: PDFPageProxy) {
  const {items} = await page.getTextContent()

  const text = items
    .map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
    .join('')

  return text.trim()
}

async function needsImage(page: PDFPageProxy, text: string, ops: typeof Ops) {
  if (text === '') return true

  const coverage = imageCoverage(
    ops,
    await page.getOperatorList(),
    page.getViewport({scale: 1})
  )

  return coverage > IMAGE_SHARE
}

async function convertPage(
  page: PDFPageProxy,
  ops: typeof Ops
): Promise<ConvertedPage> {
  const text = await textOf(page)

  return {
    text,
    image: (await needsImage(page, text, ops)) ? await renderPage(page) : null,
  }
}

function unreadable(name: string, cause: unknown, pdfjs: Pdfjs) {
  const message =
    cause instanceof pdfjs.PasswordException
      ? `${name} is password-protected, so Unimatrix Zero couldn’t read it.`
      : `Unimatrix Zero couldn’t read ${name} as a PDF.`

  return new Error(message, {cause})
}

/** Each page of the PDF `name`, whose bytes are `data`, in order. */
export async function convertBytes(name: string, data: Uint8Array) {
  const pdfjs = await loadPdfjs()
  const {getDocument, OPS} = pdfjs

  const task = getDocument({
    data,
    ...pdfjsAssets(),
    verbosity: 0,
  })

  try {
    const doc = await task.promise.catch((cause: unknown) => {
      throw unreadable(name, cause, pdfjs)
    })

    const pages: ConvertedPage[] = []

    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number)
      pages.push(await convertPage(page, OPS))
      page.cleanup()
    }

    return pages
  } finally {
    await task.destroy()
  }
}
