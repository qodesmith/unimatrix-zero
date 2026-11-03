import {defineConfig} from 'vitest/config'

/**
 * Every limit only catches a hang, sized for Node tests a stalled runner slows
 * by seconds. A wait gives up first, so a hang names what it waited for.
 */
const HANG_MS = 60_000

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          testTimeout: HANG_MS,
          hookTimeout: HANG_MS,
          expect: {poll: {timeout: HANG_MS / 2}},
          include: [
            'scripts/**/*.test.ts',
            'tooling/**/*.test.ts',
            'shared/**/*.test.ts',
            'app/main/**/*.test.ts',
            'app/preload/**/*.test.ts',
            'app/provider-host/**/*.test.ts',
            'shell/**/*.test.ts',
          ],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      'app/renderer/vite.config.ts',
    ],
  },
})
