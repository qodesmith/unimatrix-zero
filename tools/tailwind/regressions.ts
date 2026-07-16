/**
 * Diff-aware guard against hand-applied canonicalization regressions.
 *
 * The canonical-classes report can only flag non-canonical tokens present in
 * the PR head — once an engineer applies an unsafe IDE suggestion (e.g.
 * `rounded-[4px]` → `rounded-lg` while `:root` overrides `--radius`), the
 * result is a perfectly canonical class and the report goes quiet. This
 * module inspects the diff instead: for every class token a change removed,
 * if the engine's canonical suggestion for that token was added in the same
 * file, the old→new pair is re-verified for CSS equivalence. Pairs that fail
 * are rewrites the IDE suggested but the runtime cascade contradicts — real
 * visual regressions.
 */
import path from 'node:path'

import {loadClassVerifier} from './analyze'
import {extractLiterals} from './extract'

export interface RegressionCheckOptions {
  /** Project root containing `components.json`. Defaults to cwd. */
  projectRoot?: string

  /** Directories (relative to root) whose diff is inspected. */
  srcDirs?: string[]

  /** Root font-size used to map px arbitrary values to rem theme values. */
  rem?: number

  /** Git ref the working tree is diffed against. */
  baseRef?: string

  /**
   * Source of diff history. Defaults to reading the git working tree via
   * `gitHistoryReader`; tests substitute an in-memory reader. When provided,
   * `srcDirs` and `baseRef` are ignored — they only configure the default
   * reader.
   */
  history?: HistoryReader
}

/**
 * What the regression scan asks of version history: which files changed
 * since base, and what a file's text is at base and at head. Paths are
 * relative to the project root; deletions are excluded from `changedFiles`
 * (a removal adds no tokens, so it can't contain an applied suggestion).
 */
export interface HistoryReader {
  changedFiles(): Promise<string[]>

  /** File text at the base ref, or `null` when the file is new in head. */
  readBaseFile(file: string): Promise<string | null>

  /** File text in the working tree. */
  readHeadFile(file: string): Promise<string>
}

export interface CanonicalRegression {
  /** File path relative to the project root. */
  file: string
  from: string
  to: string
  reason: string
}

function git(
  args: string[],
  cwd: string
): {ok: boolean; stdout: string; stderr: string} {
  const proc = Bun.spawnSync(['git', ...args], {cwd})

  return {
    ok: proc.exitCode === 0,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  }
}

/**
 * Production `HistoryReader`: diffs the working tree against `baseRef` with
 * the git CLI.
 */
export function gitHistoryReader({
  projectRoot = process.cwd(),
  srcDirs = ['src'],
  baseRef = 'origin/main',
}: Pick<
  RegressionCheckOptions,
  'projectRoot' | 'srcDirs' | 'baseRef'
> = {}): HistoryReader {
  return {
    async changedFiles() {
      // Deleted files are excluded (`--diff-filter=d`). `--relative` keeps
      // paths cwd-relative when the project root is nested in the repository.
      const diff = git(
        [
          'diff',
          '--name-only',
          '--relative',
          '--diff-filter=d',
          baseRef,
          '--',
          ...srcDirs,
        ],
        projectRoot
      )

      if (!diff.ok) {
        throw new Error(
          `git diff against ${baseRef} failed: ${diff.stderr.trim()}`
        )
      }

      return diff.stdout.split('\n').filter(Boolean)
    },

    async readBaseFile(file) {
      // `./` scopes the path to the cwd instead of the repository root. A
      // failed show means the file is new in head — no removed tokens.
      const base = git(['show', `${baseRef}:./${file}`], projectRoot)

      return base.ok ? base.stdout : null
    },

    async readHeadFile(file) {
      return Bun.file(path.join(projectRoot, file)).text()
    },
  }
}

/** Counts each class token across a file's extracted literals. */
function tokenCounts(file: string, text: string): Map<string, number> {
  const counts = new Map<string, number>()

  for (const lit of extractLiterals(file, text)) {
    for (const token of lit.text.split(/\s+/)) {
      if (token) counts.set(token, (counts.get(token) ?? 0) + 1)
    }
  }

  return counts
}

/**
 * Diffs head against base via `history` and reports removed→added token
 * pairs that match an engine suggestion but are not CSS-equivalent.
 */
export async function findCanonicalRegressions({
  projectRoot = process.cwd(),
  srcDirs = ['src'],
  rem = 16,
  baseRef = 'origin/main',
  history = gitHistoryReader({projectRoot, srcDirs, baseRef}),
}: RegressionCheckOptions = {}): Promise<CanonicalRegression[]> {
  const verifier = await loadClassVerifier({projectRoot, rem})

  const changedFiles = (await history.changedFiles())
    .filter(file => /\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort((a, b) => a.localeCompare(b))

  // Per-file work is independent; map + flat keeps the output ordered by
  // file despite the parallel reads.
  const regressionsPerFile = await Promise.all(
    changedFiles.map(async file => {
      const headText = await history.readHeadFile(file)
      const baseText = await history.readBaseFile(file)
      const baseCounts = tokenCounts(file, baseText ?? '')
      const headCounts = tokenCounts(file, headText)
      const regressions: CanonicalRegression[] = []

      for (const token of [...baseCounts.keys()].sort()) {
        const removed =
          (baseCounts.get(token) ?? 0) > (headCounts.get(token) ?? 0)

        if (!removed) continue

        const suggestion = verifier.suggest(token)

        if (!suggestion) continue

        const added =
          (headCounts.get(suggestion) ?? 0) > (baseCounts.get(suggestion) ?? 0)

        if (!added) continue

        const {equivalent, reason} = verifier.check(token, suggestion)

        if (!equivalent) {
          regressions.push({file, from: token, to: suggestion, reason})
        }
      }

      return regressions
    })
  )

  return regressionsPerFile.flat()
}

/** Plain-text report for local runs. */
export function formatRegressionsText(
  regressions: CanonicalRegression[]
): string {
  if (regressions.length === 0) return 'no canonicalization regressions found'

  const lines = [`${regressions.length} canonicalization regression(s):`, '']

  for (const {file, from, to, reason} of regressions) {
    lines.push(`${file}: ${from} => ${to}`)

    for (const reasonLine of reason.split('\n')) {
      lines.push(`  ${reasonLine.trim()}`)
    }
  }

  return lines.join('\n')
}

/**
 * Markdown report for CI/PR comments. Returns an empty string when the diff
 * is clean.
 */
export function formatRegressionsMarkdown(
  regressions: CanonicalRegression[]
): string {
  if (regressions.length === 0) return ''

  const lines = [
    '### Unsafe Tailwind canonicalizations in this diff',
    '',
    `${regressions.length} rewrite(s) match an IDE/engine suggestion that ` +
      'is **not** CSS-equivalent at runtime (the cascade overrides the ' +
      'theme value the suggestion was based on). Applying them changes ' +
      'rendering — revert to the original class:',
    '',
    '| File | Applied change | Why it regresses |',
    '| --- | --- | --- |',
  ]

  for (const {file, from, to, reason} of regressions) {
    const why = reason
      .split('\n')
      .map(line => `\`${line.trim()}\``)
      .join('<br>')
    lines.push(`| \`${file}\` | \`${from}\` → \`${to}\` | ${why} |`)
  }

  return lines.join('\n')
}
