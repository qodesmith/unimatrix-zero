// oxlint-disable-next-line import/default -- Vite's `?url` import is the URL of the worker, emitted as its own file
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {createContext} from 'react'

/** Where `vite.config.ts` puts the files pdf.js fetches at run time. */
const PDFJS_ASSETS = 'pdfjs'

export interface PdfFile {
  pageCount: number
  /** Page 1's height over its width, for pages not drawn yet. */
  firstPageRatio: number
  /** Draws the page `width` CSS pixels wide. */
  drawPage: (
    page: number,
    canvas: HTMLCanvasElement,
    width: number,
    signal: AbortSignal
  ) => Promise<void>
  close: () => void
}

function assetsAt(folder: string) {
  return new URL(`/${PDFJS_ASSETS}/${folder}/`, location.href).href
}

/**
 * Pdf.js reads the bytes, never the URL: Chromium's own viewer would show a
 * PDF that reached a frame, and pdf.js's URL loader can't range over `uzfile:`.
 */
async function openPdf(url: string): Promise<PdfFile> {
  const response = await fetch(url)

  if (!response.ok) throw new Error('The PDF could not be read.')

  // Loaded with the first PDF, so the app starts without it.
  const {GlobalWorkerOptions, getDocument} = await import('pdfjs-dist')

  GlobalWorkerOptions.workerSrc = workerUrl

  const task = getDocument({
    data: new Uint8Array(await response.arrayBuffer()),
    cMapUrl: assetsAt('cmaps'),
    cMapPacked: true,
    iccUrl: assetsAt('iccs'),
    standardFontDataUrl: assetsAt('standard_fonts'),
    // The window's CSP compiles no wasm, so pdf.js loads its JS decoders from here.
    useWasm: false,
    wasmUrl: assetsAt('wasm'),
  })

  const document = await task.promise
  const first = (await document.getPage(1)).getViewport({scale: 1})

  return {
    pageCount: document.numPages,
    firstPageRatio: first.height / first.width,
    drawPage: async (number, canvas, width, signal) => {
      const page = await document.getPage(number)
      const natural = page.getViewport({scale: 1})

      const viewport = page.getViewport({
        scale: (width * devicePixelRatio) / natural.width,
      })

      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)

      const render = page.render({canvas, viewport})

      signal.addEventListener('abort', () => render.cancel())
      await render.promise
    },
    close: () => void task.destroy(),
  }
}

/** Tests put a fake in its place: pdf.js itself is not this app's to test. */
export const PdfOpener = createContext(openPdf)
