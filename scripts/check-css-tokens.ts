/**
 * Oxlint covers TS and TSX; this covers the stylesheets: every color in the
 * renderer's CSS has to be a Theme token, never a literal or a palette class.
 */
import {Glob} from 'bun'
import path from 'node:path'

import {colorLiteral, paletteClass} from '../tooling/theme-tokens.ts'
import {finishCheck} from './finish-check.ts'

const root = path.resolve(import.meta.dirname, '..')
const rendererSrc = path.join(root, 'app/renderer/src')
const problems: string[] = []

for await (const file of new Glob('**/*.css').scan(rendererSrc)) {
  const lines = (await Bun.file(path.join(rendererSrc, file)).text()).split(
    '\n'
  )

  lines.forEach((line, index) => {
    if (colorLiteral.test(line) || paletteClass.test(line)) {
      problems.push(`app/renderer/src/${file}:${index + 1}: ${line.trim()}`)
    }
  })
}

finishCheck(
  problems,
  'Hard-coded colors in CSS (use Theme tokens):',
  'CSS uses Theme tokens only.'
)
