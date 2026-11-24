import type {PDFPageProxy} from 'pdfjs-dist'

import {PAGE_IMAGE_PIXELS, PAGE_IMAGE_QUALITY} from '@uz/contract/extraction'

async function jpegOf(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, 'image/jpeg', PAGE_IMAGE_QUALITY)
  })

  if (!blob) throw new Error('The canvas could not encode a page image.')

  return new Uint8Array(await blob.arrayBuffer())
}

/** The page on white, `PAGE_IMAGE_PIXELS` on its long side, as a JPEG. */
export async function renderPage(page: PDFPageProxy) {
  const natural = page.getViewport({scale: 1})

  const viewport = page.getViewport({
    scale: PAGE_IMAGE_PIXELS / Math.max(natural.width, natural.height),
  })

  const canvas = document.createElement('canvas')

  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  try {
    await page.render({canvas, viewport, background: 'white'}).promise

    return await jpegOf(canvas)
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
