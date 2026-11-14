import type {PDFPageProxy} from 'pdfjs-dist'

/** Long enough for small print to stay readable, short enough to stay small. */
const LONG_SIDE_PX = 1600

/** The page as a PNG, its long side `LONG_SIDE_PX` pixels. */
export async function renderPage(page: PDFPageProxy) {
  const {createCanvas} = await import('@napi-rs/canvas')
  const {width, height} = page.getViewport({scale: 1})

  const viewport = page.getViewport({
    scale: LONG_SIDE_PX / Math.max(width, height),
  })

  const canvas = createCanvas(
    Math.round(viewport.width),
    Math.round(viewport.height)
  )

  await page.render({canvas, viewport}).promise

  return new Uint8Array(await canvas.encode('png'))
}
