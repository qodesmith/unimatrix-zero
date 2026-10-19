import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
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
