/**
 * Canonicalize Tailwind classes across the project's component files using
 * the project's own design system — the same engine Tailwind IntelliSense
 * uses for its `suggestCanonicalClasses` lint.
 *
 * Pipeline (see the sibling modules):
 * 1. `extract.ts` — pull class tokens from string literals in className
 * attrs and cn/cva/clsx/tv/twMerge calls
 * 2. `analyze.ts` — canonicalize each token 1:1 via `canonicalizeCandidates`
 * and verify each old→new pair compiles to equivalent CSS (rejecting real
 * regressions the canonicalizer can suggest, e.g. `rounded-[4px]` →
 * `rounded-lg` when `:root` overrides `--radius` at runtime)
 * 3. `apply.ts` — write the verified replacements in place
 * 4. `report.ts` — text (local) and markdown (CI/PR comment) reports
 *
 * CLI (run from the project root):
 * - `bun tools/tailwind/canonicalize-classes.ts` — dry-run text report
 * - `bun tools/tailwind/canonicalize-classes.ts --apply` — write the fixes
 * - `bun tools/tailwind/canonicalize-classes.ts --markdown` — check-only
 * report for CI/PR comments; prints nothing when everything is canonical.
 * Always exits 0 — the CI workflow fails the check itself when this prints
 * findings, after posting the PR comment.
 *
 * Companion guard: `check-regressions.ts` (see `regressions.ts`) inspects a
 * PR's diff for hand-applied engine suggestions that fail CSS-equivalence —
 * regressions this tree-based report can't see — and blocks on them.
 */
import {analyzeTailwindClasses} from './analyze'
import {applyCanonicalFixes} from './apply'
import {formatMarkdownReport, formatTextReport} from './report'

export {analyzeTailwindClasses} from './analyze'
export {applyCanonicalFixes} from './apply'
export {formatMarkdownReport, formatTextReport} from './report'

if (import.meta.main) {
  const apply = Bun.argv.includes('--apply')
  const markdown = Bun.argv.includes('--markdown')
  const analysis = await analyzeTailwindClasses()

  /* oxlint-disable no-console */
  if (markdown) {
    const report = formatMarkdownReport(analysis)
    if (report) console.log(report)
  } else {
    console.log(formatTextReport(analysis))

    if (apply) {
      const changedFiles = await applyCanonicalFixes(analysis)

      for (const file of changedFiles) console.log(`updated: ${file}`)
      console.log(`\napplied to ${changedFiles.length} files`)
    } else {
      console.log('\n(dry run — pass --apply to write changes)')
    }
  }
  /* oxlint-enable no-console */
}
