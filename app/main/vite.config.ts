import {nodeBundle} from '@uz/tooling/vite'
import {defineConfig} from 'vite'

export default defineConfig(({mode}) =>
  nodeBundle({
    root: import.meta.dirname,
    entry: {main: 'src/index.ts'},
    format: 'es',
    mode,
    define: {__UZ_DEV__: mode === 'production' ? 'false' : 'true'},
  })
)
