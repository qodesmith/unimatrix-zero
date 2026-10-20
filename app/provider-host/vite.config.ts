import {nodeBundle} from '@uz/tooling/vite'
import {defineConfig} from 'vite'

export default defineConfig(({mode}) =>
  nodeBundle({
    root: import.meta.dirname,
    entry: {claude: 'src/claude.ts', chatgpt: 'src/chatgpt.ts'},
    format: 'es',
    mode,
  })
)
