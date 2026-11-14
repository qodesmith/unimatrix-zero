import {nodeBundle} from '@uz/tooling/vite'
import {defineConfig} from 'vite'

export default defineConfig(({mode}) =>
  nodeBundle({
    root: import.meta.dirname,
    entry: {claude: 'src/claude.ts', chatgpt: 'src/chatgpt.ts'},
    format: 'es',
    mode,
    // pdf.js reads its fonts from its own folder; the canvas is native code,
    // which ADR 0007 keeps out of the app bundle.
    external: [/^pdfjs-dist\//u, '@napi-rs/canvas'],
  })
)
