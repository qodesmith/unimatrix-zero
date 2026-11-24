import {chromeTarget} from '@uz/tooling/vite'
import {playwright} from '@vitest/browser-playwright'
import {defineConfig} from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: chromeTarget,
    sourcemap: true,
  },
  test: {
    name: 'extractor',
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}],
    },
  },
})
