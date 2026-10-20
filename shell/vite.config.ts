import {nodeBundle} from '@uz/tooling/vite'
import path from 'node:path'
import {defineConfig} from 'vite'

const devMainBundle = path.resolve(
  import.meta.dirname,
  '../app/main/dist/main.mjs'
)

export default defineConfig(({mode}) =>
  nodeBundle({
    root: import.meta.dirname,
    entry: {index: 'src/index.ts'},
    format: 'cjs',
    mode,
    define: {
      __UZ_DEV_MAIN_BUNDLE__:
        mode === 'production' ? 'null' : JSON.stringify(devMainBundle),
    },
  })
)
