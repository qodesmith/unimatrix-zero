import tailwindcss from '@tailwindcss/vite'
import {chromeTarget} from '@uz/tooling/vite'
import react from '@vitejs/plugin-react'
import {playwright} from '@vitest/browser-playwright'
import path from 'node:path'
import {defineConfig} from 'vite'

const cn = path.join(import.meta.dirname, 'node_modules/cn')

/** Runs outside UTC: in CI's UTC, a reset time formatted in UTC passes as local. */
const ZONED = 'src/modules/turns/ui/FailedChip.test.tsx'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
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
