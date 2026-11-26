import type {Plugin} from 'vite'

import tailwindcss from '@tailwindcss/vite'
import {chromeTarget} from '@uz/tooling/vite'
import react from '@vitejs/plugin-react'
import {playwright} from '@vitest/browser-playwright'
import {readFileSync, readdirSync} from 'node:fs'
import path from 'node:path'
import {defineConfig} from 'vite'

const cn = path.join(import.meta.dirname, 'node_modules/cn')

const pdfjs = path.join(import.meta.dirname, 'node_modules/pdfjs-dist')

/** Pdf.js fetches these at run time, from `tree-files/pdf.ts`'s URLs. */
const PDFJS_FOLDERS = ['cmaps', 'iccs', 'standard_fonts', 'wasm']

const PDFJS_PREFIX = '/pdfjs'

/** The page's own origin serves them: in `dist/pdfjs/`, or from Vite in dev. */
function pdfjsAssets(): Plugin {
  return {
    name: 'uz-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use(PDFJS_PREFIX, (request, response, next) => {
        const [folder = '', file = '', ...rest] = (request.url ?? '')
          .replaceAll(/^\/|\?.*$/g, '')
          .split('/')

        const known =
          rest.length === 0 &&
          PDFJS_FOLDERS.includes(folder) &&
          readdirSync(path.join(pdfjs, folder)).includes(file)

        if (known) response.end(readFileSync(path.join(pdfjs, folder, file)))
        else next()
      })
    },
    generateBundle() {
      for (const folder of PDFJS_FOLDERS)
        for (const file of readdirSync(path.join(pdfjs, folder)))
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${folder}/${file}`,
            source: readFileSync(path.join(pdfjs, folder, file)),
          })
    },
  }
}

/** Runs outside UTC: in CI's UTC, a reset time formatted in UTC passes as local. */
const ZONED = 'src/modules/turns/ui/FailedChip.test.tsx'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), pdfjsAssets()],
  resolve: {alias: {clsx: cn, 'tailwind-merge': cn}},
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: chromeTarget,
    sourcemap: true,
  },
  test: {
    name: 'renderer',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      viewport: {width: 1280, height: 800},
      instances: [
        {browser: 'chromium', exclude: [ZONED]},
        {
          browser: 'chromium',
          name: 'renderer (chromium, Asia/Kolkata)',
          include: [ZONED],
          provider: playwright({contextOptions: {timezoneId: 'Asia/Kolkata'}}),
        },
      ],
    },
  },
})
