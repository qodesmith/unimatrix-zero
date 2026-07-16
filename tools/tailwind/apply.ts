import type {TailwindClassAnalysis} from './analyze'

import path from 'node:path'

/**
 * A single token rewrite, produced by analysis. Offsets index into the
 * file's source text; `original` is the exact text at `[start, end)`,
 * letting the applier verify the file hasn't drifted since analysis.
 */
export interface Edit {
  /** File path relative to the project root. */
  file: string

  /** Start offset of the replaced token in the source text. */
  start: number

  /** End offset (exclusive) of the replaced token. */
  end: number

  /** The token currently at `[start, end)`. */
  original: string

  /** The canonical token to write in its place. */
  replacement: string
}

/**
 * Applies the verified replacements from an analysis to disk. Returns the
 * changed file paths (relative to the project root).
 */
export async function applyCanonicalFixes(
  analysis: TailwindClassAnalysis
): Promise<string[]> {
  const replacements = new Map(
    analysis.verified.map(pair => [pair.from, pair.to])
  )
  const changedFiles: string[] = []

  if (replacements.size === 0) return changedFiles

  const writes: Promise<number>[] = []

  for (const [file, originalText] of analysis.fileTexts) {
    let text = originalText
    let changed = false
    const fileLits = analysis.literals
      .filter(lit => lit.file === file)
      .sort((a, b) => b.start - a.start) // End-first keeps offsets valid.

    for (const lit of fileLits) {
      const newText = lit.text
        .split(/(\s+)/)
        .map(part => replacements.get(part) ?? part)
        .join('')

      if (newText !== lit.text) {
        text = text.slice(0, lit.start) + newText + text.slice(lit.end)
        changed = true
      }
    }

    if (changed) {
      writes.push(Bun.write(file, text))
      changedFiles.push(path.relative(analysis.projectRoot, file))
    }
  }

  await Promise.all(writes)

  return changedFiles
}
