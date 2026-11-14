import {createRequire} from 'node:module'
import path from 'node:path'

async function importPdfjs() {
  // pdf.js takes any Electron process but main for a browser, a utility
  // process included, and decides once, as it loads.
  const type = Object.getOwnPropertyDescriptor(process, 'type')
  Object.defineProperty(process, 'type', {value: undefined, configurable: true})

  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // With `pdfjsWorker` set, pdf.js runs its worker in this thread.
    Reflect.set(
      globalThis,
      'pdfjsWorker',
      await import('pdfjs-dist/legacy/build/pdf.worker.mjs')
    )

    return pdfjs
  } finally {
    if (type) Object.defineProperty(process, 'type', type)
    else Reflect.deleteProperty(process, 'type')
  }
}

let loading: ReturnType<typeof importPdfjs> | undefined

/** Loads pdf.js the first time a PDF is converted. */
export async function loadPdfjs() {
  loading ??= importPdfjs()

  return loading
}

/**
 * The folders pdf.js reads its fonts, CMaps and wasm from, as paths
 * ending in a separator, since in Node it reads them with `fs`.
 */
export function pdfjsAssets() {
  const folder = path.dirname(
    createRequire(import.meta.url).resolve('pdfjs-dist/package.json')
  )

  function asset(name: string) {
    return path.join(folder, name) + path.sep
  }

  return {
    standardFontDataUrl: asset('standard_fonts'),
    cMapUrl: asset('cmaps'),
    wasmUrl: asset('wasm'),
  }
}
