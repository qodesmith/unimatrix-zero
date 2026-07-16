/**
 * Canonicalize Tailwind classes across the project's component files using
 * the project's own design system — the same engine Tailwind IntelliSense
 * uses for its `suggestCanonicalClasses` lint.
 *
 * Pipeline:
 * 1. Load the design system from the css file referenced by `components.json`
 * 2. Extract class tokens from string literals in className attrs and
 * cn/cva/clsx/tv/twMerge calls
 * 3. Canonicalize each unique token 1:1 via `canonicalizeCandidates`
 * 4. Verify each old→new pair compiles to equivalent CSS (rejecting real
 * regressions the canonicalizer can suggest, e.g. `rounded-[4px]` →
 * `rounded-lg` when `:root` overrides `--radius` at runtime)
 * 5. Optionally apply the verified replacements in place
 *
 * CLI: `bun tools/tailwind/canonicalize-classes.ts [--apply]` (dry run by
 * default, run from the project root)
 */
import {__unstable__loadDesignSystem} from '@tailwindcss/node'

import path from 'node:path'

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

export interface CanonicalizeOptions {
  /** Project root containing `components.json`. Defaults to cwd. */
  projectRoot?: string

  /** Directories (relative to root) to scan for `.ts`/`.tsx` files. */
  srcDirs?: string[]

  /** Root font-size used to map px arbitrary values to rem theme values. */
  rem?: number

  /** Write the verified replacements to disk. Defaults to dry run. */
  apply?: boolean
}

export interface RejectedPair {
  from: string
  to: string
  reason: string
}

export interface CanonicalizeResult {
  filesScanned: number
  uniqueTokens: number

  /** Verified old→new replacements, sorted by old token. */
  verified: [string, string][]

  /** Engine-suggested pairs that failed CSS-equivalence verification. */
  rejected: RejectedPair[]

  /** Files written (relative to root). Empty on dry runs. */
  changedFiles: string[]
}

const CLASS_FN_RE = /\b(?:cn|cva|clsx|tv|twMerge)\s*\(/g

interface Literal {
  file: string

  /** Offsets of the literal's contents (between the quotes). */
  start: number
  end: number
  text: string
}

const SOURCE_GLOB = new Bun.Glob('**/*.{ts,tsx}')

function walk(dir: string): string[] {
  // Sorted traversal keeps every run's output byte-identical.
  return [...SOURCE_GLOB.scanSync({cwd: dir, absolute: true})]
    .filter(file => !file.endsWith('.d.ts'))
    .sort((a, b) => a.localeCompare(b))
}

/**
 * Returns the end index (exclusive) of a string literal starting at `i`, or
 * -1 for a template literal containing `${}` (which can't be safely
 * tokenized as a plain class string).
 */
function scanString(text: string, i: number): number {
  const quote = text[i]

  for (let j = i + 1; j < text.length; j++) {
    const ch = text[j]

    if (ch === '\\') {
      j++
    } else if (ch === quote) {
      return j + 1
    } else if (quote === '`' && ch === '$' && text[j + 1] === '{') {
      return -1
    } else if (quote !== '`' && ch === '\n') {
      return j // Unterminated string — bail at the newline.
    }
  }

  return text.length
}

function collectStringsInSpan(
  literals: Literal[],
  file: string,
  text: string,
  from: number,
  to: number
): void {
  for (let i = from; i < to; i++) {
    const ch = text[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = scanString(text, i)

      if (end === -1) {
        // Template with interpolation — skip past it wholesale.
        let depth = 0
        let j = i + 1

        for (; j < to; j++) {
          if (text[j] === '\\') j++
          else if (text[j] === '`' && depth === 0) break
          else if (text[j] === '$' && text[j + 1] === '{') depth++
          else if (text[j] === '}' && depth > 0) depth--
        }

        i = j
        continue
      }

      const inner = text.slice(i + 1, end - 1)

      // Escapes never appear in real class strings; skipping them means
      // literal offsets map 1:1 to source text when applying edits.
      if (inner.trim() && !inner.includes('\\')) {
        literals.push({file, start: i + 1, end: end - 1, text: inner})
      }

      i = end - 1
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < to && text[i] !== '\n') i++
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? to : close + 1
    }
  }
}

/** Finds the end of a balanced-paren span starting at `openParen`. */
function balancedEnd(text: string, openParen: number): number {
  let depth = 0

  for (let i = openParen; i < text.length; i++) {
    const ch = text[i]

    if (ch === "'" || ch === '"' || ch === '`') {
      const end = scanString(text, i)
      i = end === -1 ? text.indexOf('`', i + 1) : end - 1
      if (i < 0) return text.length
    } else if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) return i + 1
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? text.length : close + 1
    }
  }

  return text.length
}

function extractLiterals(file: string, text: string): Literal[] {
  const literals: Literal[] = []
  const spans: [number, number][] = []

  // className="..." / className={...}
  const attrRe = /className=/g
  let m: RegExpExecArray | null

  while ((m = attrRe.exec(text))) {
    const after = m.index + m[0].length

    if (text[after] === '"' || text[after] === "'") {
      const end = scanString(text, after)
      spans.push([after, end === -1 ? after : end])
    } else if (text[after] === '{') {
      let depth = 0
      let j = after

      for (; j < text.length; j++) {
        const ch = text[j]

        if (ch === "'" || ch === '"' || ch === '`') {
          const end = scanString(text, j)
          if (end !== -1) j = end - 1
        } else if (ch === '{') {
          depth++
        } else if (ch === '}') {
          depth--
          if (depth === 0) break
        }
      }

      spans.push([after, j + 1])
    }
  }

  // cn(...) / cva(...) / clsx(...) / tv(...) / twMerge(...)
  CLASS_FN_RE.lastIndex = 0
  while ((m = CLASS_FN_RE.exec(text))) {
    const openParen = m.index + m[0].length - 1
    spans.push([openParen, balancedEnd(text, openParen)])
  }

  // Merge overlapping spans so literals aren't collected twice.
  spans.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []

  for (const span of spans) {
    const last = merged.at(-1)

    if (last && span[0] < last[1]) {
      last[1] = Math.max(last[1], span[1])
    } else {
      merged.push([...span])
    }
  }

  for (const [from, to] of merged) {
    collectStringsInSpan(literals, file, text, from, to)
  }

  return literals
}

/**
 * Normalizes compiled CSS so that only benign representational differences
 * collapse: theme var indirection, px↔rem (at the configured root
 * font-size), spacing-scale expansion, `:has(*:is(X))` vs `:has(X)`, and
 * redundant parens. Anything still differing after normalization is a real
 * regression.
 */
function makeNormalizer(
  designSystem: DesignSystem,
  css: string,
  rem: number
): (compiled: string) => string {
  // The user's own :root/@theme declarations win the cascade over defaults
  // pulled in by @import, so they must take precedence over
  // resolveThemeValue when flattening var() indirection. First declaration
  // wins here — later duplicates are alternate color schemes (e.g. `.dark`),
  // and picking either side consistently is enough for equivalence checks.
  const varMap = new Map<string, string>()

  for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
    if (!varMap.has(m[1])) varMap.set(m[1], m[2].trim())
  }

  return compiled => {
    // Compare declaration bodies only — the top-level selector always
    // differs between the old and new class names.
    let s = compiled.replace(/^\s*\.[^{]+/, '')

    for (let i = 0; i < 10; i++) {
      const next = s.replaceAll(
        /var\((--[\w-]+)(?:\s*,\s*[^)]*)?\)/g,
        (m0, v: string) => {
          const resolved = varMap.get(v) ?? designSystem.resolveThemeValue(v)
          return resolved ?? m0
        }
      )

      if (next === s) break
      s = next
    }

    s = s.replaceAll(
      /(-?\d*\.?\d+)px/g,
      (_m, n: string) => `${parseFloat(n) / rem}rem`
    )

    for (let i = 0; i < 5; i++) {
      const next = s
        .replaceAll(
          /calc\((-?\d*\.?\d+)rem \* (-?\d*\.?\d+)\)/g,
          (_m, a: string, b: string) => `${parseFloat(a) * parseFloat(b)}rem`
        )
        .replaceAll(/\((-?\d*\.?\d+(?:rem|em|%)?)\)/g, '$1')

      if (next === s) break
      s = next
    }

    s = s.replaceAll(/:has\(\*:is\(([^()]*)\)\)/g, ':has($1)')
    s = s.replaceAll(
      /(-?\d*\.?\d+)rem/g,
      (_m, n: string) => `${parseFloat(n)}rem`
    )

    return s.replaceAll(/\s+/g, ' ').trim()
  }
}

export async function canonicalizeTailwindClasses({
  projectRoot = process.cwd(),
  srcDirs = ['src'],
  rem = 16,
  apply = false,
}: CanonicalizeOptions = {}): Promise<CanonicalizeResult> {
  const componentsJson = (await Bun.file(
    path.join(projectRoot, 'components.json')
  ).json()) as {tailwind?: {css?: string}}
  const cssRelPath = componentsJson.tailwind?.css

  if (!cssRelPath) {
    throw new Error('components.json has no tailwind.css path')
  }

  const cssFile = path.join(projectRoot, cssRelPath)
  const css = await Bun.file(cssFile).text()
  const designSystem = await __unstable__loadDesignSystem(css, {
    base: path.dirname(cssFile),
  })

  const files = srcDirs.flatMap(dir => walk(path.join(projectRoot, dir)))
  const fileTexts = new Map(
    await Promise.all(
      files.map(async file => [file, await Bun.file(file).text()] as const)
    )
  )
  const literals = files.flatMap(file =>
    extractLiterals(file, fileTexts.get(file) ?? '')
  )

  const tokens = new Set<string>()
  for (const lit of literals) {
    for (const token of lit.text.split(/\s+/)) {
      if (token) tokens.add(token)
    }
  }

  // One token per call keeps the old→new mapping strictly 1:1.
  const mapping = new Map<string, string>()
  for (const token of [...tokens].sort()) {
    const [canon] = designSystem.canonicalizeCandidates([token], {rem})
    if (canon && canon !== token) mapping.set(token, canon)
  }

  const normalize = makeNormalizer(designSystem, css, rem)
  const verified = new Map<string, string>()
  const rejected: RejectedPair[] = []

  for (const [from, to] of mapping) {
    const [fromCss] = designSystem.candidatesToCss([from])
    const [toCss] = designSystem.candidatesToCss([to])

    if (typeof toCss !== 'string') {
      rejected.push({from, to, reason: 'new candidate compiles to null'})
      continue
    }

    if (typeof fromCss !== 'string') {
      // Not compilable — likely a non-class string that slipped through
      // extraction. Never rewrite what we can't verify.
      rejected.push({from, to, reason: 'old candidate compiles to null'})
      continue
    }

    if (normalize(fromCss) === normalize(toCss)) {
      verified.set(from, to)
    } else {
      rejected.push({
        from,
        to,
        reason:
          `css mismatch:\n  OLD: ${normalize(fromCss)}` +
          `\n  NEW: ${normalize(toCss)}`,
      })
    }
  }

  const changedFiles: string[] = []

  if (apply && verified.size > 0) {
    const writes: Promise<number>[] = []

    for (const file of files) {
      let text = fileTexts.get(file) ?? ''
      let changed = false
      const fileLits = literals
        .filter(lit => lit.file === file)
        .sort((a, b) => b.start - a.start) // End-first keeps offsets valid.

      for (const lit of fileLits) {
        const newText = lit.text
          .split(/(\s+)/)
          .map(part => verified.get(part) ?? part)
          .join('')

        if (newText !== lit.text) {
          text = text.slice(0, lit.start) + newText + text.slice(lit.end)
          changed = true
        }
      }

      if (changed) {
        writes.push(Bun.write(file, text))
        changedFiles.push(path.relative(projectRoot, file))
      }
    }

    await Promise.all(writes)
  }

  return {
    filesScanned: files.length,
    uniqueTokens: tokens.size,
    verified: [...verified].sort(([a], [b]) => a.localeCompare(b)),
    rejected,
    changedFiles,
  }
}

if (import.meta.main) {
  const apply = Bun.argv.includes('--apply')
  const result = await canonicalizeTailwindClasses({apply})

  /* oxlint-disable no-console */
  console.log(
    `files scanned: ${result.filesScanned}, ` +
      `unique tokens: ${result.uniqueTokens}`
  )

  console.log(`\n=== VERIFIED MAPPING (${result.verified.length}) ===`)
  for (const [from, to] of result.verified) console.log(`${from} => ${to}`)

  if (result.rejected.length > 0) {
    console.log(`\n=== REJECTED (${result.rejected.length}) ===`)
    for (const r of result.rejected) {
      console.log(`${r.from} => ${r.to}\n  ${r.reason}`)
    }
  }

  if (apply) {
    for (const file of result.changedFiles) console.log(`updated: ${file}`)
    console.log(`\napplied to ${result.changedFiles.length} files`)
  } else {
    console.log('\n(dry run — pass --apply to write changes)')
  }
  /* oxlint-enable no-console */
}
