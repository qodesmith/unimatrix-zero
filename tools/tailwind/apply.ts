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
 * Applies analysis edits to disk. Every edit is validated against the
 * current file contents before anything is written — a stale edit throws
 * and no file is touched. Returns the changed file paths (relative to the
 * project root), sorted.
 */
export async function applyCanonicalFixes({
  projectRoot,
  edits,
}: {
  projectRoot: string
  edits: Edit[]
}): Promise<string[]> {
  const editsByFile = new Map<string, Edit[]>()

  for (const edit of edits) {
    const entry = editsByFile.get(edit.file) ?? []

    entry.push(edit)
    editsByFile.set(edit.file, entry)
  }

  const texts = new Map(
    await Promise.all(
      [...editsByFile.keys()].map(async file => {
        const text = await Bun.file(path.join(projectRoot, file)).text()

        return [file, text] as const
      })
    )
  )

  // Validate everything before writing anything: a throw means zero writes.
  for (const [file, fileEdits] of editsByFile) {
    const text = texts.get(file) ?? ''

    for (const {start, end, original} of fileEdits) {
      const actual = text.slice(start, end)

      if (actual !== original) {
        throw new Error(
          `${file}:${start}-${end} contains ${JSON.stringify(actual)}, ` +
            `expected ${JSON.stringify(original)} — the file changed after ` +
            'analysis; re-run it'
        )
      }
    }
  }

  const writes: Promise<number>[] = []

  for (const [file, fileEdits] of editsByFile) {
    let text = texts.get(file) ?? ''

    // End-first keeps earlier offsets valid as replacements change length.
    for (const edit of [...fileEdits].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end)
    }

    writes.push(Bun.write(path.join(projectRoot, file), text))
  }

  await Promise.all(writes)

  return [...editsByFile.keys()].sort((a, b) => a.localeCompare(b))
}
