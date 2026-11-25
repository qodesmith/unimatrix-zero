import type {Plugin} from 'vite'

import {chromeTarget} from '@uz/tooling/vite'
import {playwright} from '@vitest/browser-playwright'
import {readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {defineConfig} from 'vite'

const pdfjs = path.join(import.meta.dirname, 'node_modules/pdfjs-dist')

/** Pdf.js fetches these at run time, from the URLs `pdfAssetsAt` builds. */
const PDFJS_FOLDERS = ['cmaps', 'iccs', 'standard_fonts', 'wasm']

// Every limit only catches a hang: a 100-page PDF renders in a few seconds.
const HANG_MS = 60_000

function pdfjsAssets(): Plugin {
  return {
    name: 'uz-pdfjs-assets',
    apply: 'build',
    generateBundle() {
      for (const folder of PDFJS_FOLDERS)
        for (const file of readdirSync(path.join(pdfjs, folder)))
          this.emitFile({
            type: 'asset',
            fileName: `${folder}/${file}`,
            source: readFileSync(path.join(pdfjs, folder, file)),
          })
    },
  }
}

export default defineConfig({
  root: import.meta.dirname,
  plugins: [pdfjsAssets()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: chromeTarget,
    sourcemap: true,
  },
  optimizeDeps: {include: ['fflate', 'pdfjs-dist', 'zod']},
  test: {
    name: 'extractor',
    include: ['src/**/*.test.ts'],
    testTimeout: HANG_MS,
    hookTimeout: HANG_MS,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}],
    },
  },
})
