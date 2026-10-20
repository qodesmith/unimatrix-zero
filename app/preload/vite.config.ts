import {nodeBundle, selfContainedPreload} from '@uz/tooling/vite'
import {defineConfig} from 'vite'

export default defineConfig(({mode}) =>
  nodeBundle({
    root: import.meta.dirname,
    entry: {preload: 'src/index.ts'},
    format: 'cjs',
    mode,
    plugins: [selfContainedPreload()],
  })
)
