import path from 'node:path'
import {transformSync} from 'rolldown/utils'
import {parseSync} from 'vite'
import {z} from 'zod'

const PARSED = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
])

// A comment a tool may read, such as `@vitest-environment`, which picks where
// a test runs.
const DIRECTIVE = /@[a-z]|__[A-Z_]+__/

const BigIntValue = z.bigint()

export function isCode(file: string) {
  return PARSED.has(path.extname(file))
}

function treeOf(file: string, source: string) {
  const {comments} = parseSync(file, source)

  // `onlyRemoveTypeImports` keeps an import the code never uses, as
  // `verbatimModuleSyntax` does when the repo builds.
  const erased = transformSync(file, source, {
    jsx: 'preserve',
    tsconfig: false,
    typescript: {onlyRemoveTypeImports: true},
  })

  if (erased.errors.length > 0) return null

  const {program} = parseSync('erased.jsx', erased.code, {
    preserveParens: false,
  })

  const directives = comments
    .map(comment => comment.value)
    .filter(value => DIRECTIVE.test(value))

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- JSON.stringify hands its replacer every value in the tree
  return JSON.stringify([program, directives], (key, value: unknown) => {
    if (key === 'start' || key === 'end') return undefined

    // JSON.stringify throws on a bigint literal's value.
    const big = BigIntValue.safeParse(value)

    return big.success ? String(big.data) : value
  })
}

/**
 * Whether two versions of a file, with their types erased, parse to the same
 * syntax tree and hold the same directive comments in the same order.
 */
export function sameCode(file: string, before: string, after: string) {
  if (!isCode(file)) return false

  const tree = treeOf(file, before)

  return tree !== null && tree === treeOf(file, after)
}
