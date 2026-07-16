/**
 * Analysis: canonicalize each extracted class token via Tailwind's own
 * `canonicalizeCandidates` engine, then verify every old→new pair compiles
 * to equivalent CSS. Pure — never writes to disk.
 */
import type {Literal} from './extract'

import {__unstable__loadDesignSystem} from '@tailwindcss/node'

import path from 'node:path'

import {classTokens, extractLiterals, walk} from './extract'

type DesignSystem = Awaited<ReturnType<typeof __unstable__loadDesignSystem>>

export interface AnalyzeOptions {
  /** Project root containing `components.json`. Defaults to cwd. */
  projectRoot?: string

  /** Directories (relative to root) to scan for `.ts`/`.tsx` files. */
  srcDirs?: string[]

  /** Root font-size used to map px arbitrary values to rem theme values. */
  rem?: number
}

export interface TokenLocation {
  /** File path relative to the project root. */
  file: string

  /** 1-based line number. */
  line: number
}

export interface CanonicalPair {
  from: string
  to: string
  locations: TokenLocation[]
}

export interface RejectedPair {
  from: string
  to: string
  reason: string
}

export interface TailwindClassAnalysis {
  projectRoot: string
  filesScanned: number
  uniqueTokens: number

  /** Verified old→new replacements, sorted by old token. */
  verified: CanonicalPair[]

  /** Engine-suggested pairs that failed CSS-equivalence verification. */
  rejected: RejectedPair[]

  /** Extracted literals and file contents, consumed by applyCanonicalFixes. */
  literals: Literal[]
  fileTexts: Map<string, string>
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
  // Comments are stripped first — commented-out (or merely mentioned)
  // `--var: value` text would otherwise poison the map.
  const varMap = new Map<string, string>()
  const cssSansComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '')

  for (const m of cssSansComments.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)[;}]/g)) {
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

function computeLineStarts(text: string): number[] {
  const starts = [0]

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1)
  }

  return starts
}

/** Returns the 1-based line number containing `offset`. */
function lineAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1

  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2)

    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }

  return lo + 1
}

export interface ClassEquivalence {
  equivalent: boolean

  /** Why the pair failed verification; empty when equivalent. */
  reason: string
}

export interface ClassVerifier {
  /** The engine's canonical suggestion for a token, or null when none. */
  suggest(token: string): string | null

  /** Verifies that an old→new rewrite compiles to equivalent CSS. */
  check(from: string, to: string): ClassEquivalence
}

/**
 * Loads the project's design system and returns the canonicalize/verify
 * primitives shared by `analyzeTailwindClasses` and the diff-aware
 * regression check.
 */
export async function loadClassVerifier({
  projectRoot = process.cwd(),
  rem = 16,
}: Omit<AnalyzeOptions, 'srcDirs'> = {}): Promise<ClassVerifier> {
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
  const normalize = makeNormalizer(designSystem, css, rem)

  return {
    suggest(token) {
      const [canon] = designSystem.canonicalizeCandidates([token], {rem})
      return canon && canon !== token ? canon : null
    },

    check(from, to) {
      const [fromCss] = designSystem.candidatesToCss([from])
      const [toCss] = designSystem.candidatesToCss([to])

      if (typeof toCss !== 'string') {
        return {equivalent: false, reason: 'new candidate compiles to null'}
      }

      if (typeof fromCss !== 'string') {
        // Not compilable — likely a non-class string that slipped through
        // extraction. Never rewrite what we can't verify.
        return {equivalent: false, reason: 'old candidate compiles to null'}
      }

      if (normalize(fromCss) === normalize(toCss)) {
        return {equivalent: true, reason: ''}
      }

      return {
        equivalent: false,
        reason:
          `css mismatch:\n  OLD: ${normalize(fromCss)}` +
          `\n  NEW: ${normalize(toCss)}`,
      }
    },
  }
}

/**
 * Scans the project and reports which class tokens can be rewritten in
 * canonical form. Pure analysis — never touches disk; pass the result to
 * `applyCanonicalFixes` to write the changes.
 */
export async function analyzeTailwindClasses({
  projectRoot = process.cwd(),
  srcDirs = ['src'],
  rem = 16,
}: AnalyzeOptions = {}): Promise<TailwindClassAnalysis> {
  const verifier = await loadClassVerifier({projectRoot, rem})
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
    for (const token of classTokens(lit.text)) tokens.add(token)
  }

  // One token per call keeps the old→new mapping strictly 1:1.
  const mapping = new Map<string, string>()
  for (const token of [...tokens].sort()) {
    const canon = verifier.suggest(token)
    if (canon) mapping.set(token, canon)
  }

  const verified = new Map<string, string>()
  const rejected: RejectedPair[] = []

  for (const [from, to] of mapping) {
    const result = verifier.check(from, to)

    if (result.equivalent) {
      verified.set(from, to)
    } else {
      rejected.push({from, to, reason: result.reason})
    }
  }

  // Map each rewritable token to the source locations where it appears so
  // reports can point at exact lines.
  const lineStartsCache = new Map<string, number[]>()
  const locations = new Map<string, TokenLocation[]>()

  for (const lit of literals) {
    let offset = lit.start

    for (const part of lit.text.split(/(\s+)/)) {
      if (verified.has(part)) {
        let starts = lineStartsCache.get(lit.file)

        if (!starts) {
          starts = computeLineStarts(fileTexts.get(lit.file) ?? '')
          lineStartsCache.set(lit.file, starts)
        }

        const entry = locations.get(part) ?? []
        entry.push({
          file: path.relative(projectRoot, lit.file),
          line: lineAt(starts, offset),
        })
        locations.set(part, entry)
      }

      offset += part.length
    }
  }

  return {
    projectRoot,
    filesScanned: files.length,
    uniqueTokens: tokens.size,
    verified: [...verified]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([from, to]) => ({from, to, locations: locations.get(from) ?? []})),
    rejected,
    literals,
    fileTexts,
  }
}
