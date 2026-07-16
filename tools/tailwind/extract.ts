/**
 * Extraction of Tailwind class-string literals from `.ts`/`.tsx` source:
 * className attributes and cn/cva/clsx/tv/twMerge call arguments, located by
 * a lightweight scanner (string-, comment-, and template-aware) rather than
 * a full parser.
 */
export interface Literal {
  file: string

  /** Offsets of the literal's contents (between the quotes). */
  start: number
  end: number
  text: string
}

const CLASS_FN_RE = /\b(?:cn|cva|clsx|tv|twMerge)\s*\(/g

/** Splits a class string into its whitespace-separated tokens. */
export function classTokens(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
}

const SOURCE_GLOB = new Bun.Glob('**/*.{ts,tsx}')

export function walk(dir: string): string[] {
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

export function extractLiterals(file: string, text: string): Literal[] {
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
