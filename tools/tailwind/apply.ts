import type {TailwindClassAnalysis} from './analyze'

import path from 'node:path'

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
