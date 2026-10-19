import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import {playwright} from '@vitest/browser-playwright'
import {defineConfig} from 'vite'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome152',
    sourcemap: true,
  },
  test: {
    name: 'renderer',
    include: ['src/**/*.test.{ts,tsx}'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{browser: 'chromium'}],
    },
  },
})
