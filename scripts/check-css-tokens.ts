/**
 * Oxlint covers TS and TSX; this covers the stylesheets: every colour in the
 * renderer's CSS has to be a Theme token, never a literal or a palette class.
 */
import {Glob} from 'bun'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const rendererSrc = path.join(root, 'app/renderer/src')
const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(/
const palette =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|accent|caret|divide|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?\b/

const problems: string[] = []
for await (const file of new Glob('**/*.css').scan(rendererSrc)) {
  const lines = (await Bun.file(path.join(rendererSrc, file)).text()).split(
    '\n'
  )
  lines.forEach((line, index) => {
    if (literal.test(line) || palette.test(line)) {
      problems.push(`app/renderer/src/${file}:${index + 1}: ${line.trim()}`)
    }
  })
}

if (problems.length > 0) {
  console.error(
    'Hard-coded colours in CSS (use Theme tokens):\n' + problems.join('\n')
  )
  process.exit(1)
}
console.log('CSS uses Theme tokens only.')
