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
 * 4. `report.ts` — text (local) and markdown (CI/PR comment) reports via
 * the shared findings module (`tools/findings.ts`)
 *
 * CLI (see `cli.ts` for the shared flag parsing and exit contract):
 * - `bun run lint:tailwind` — dry-run text report; exits 1 on verified
 * findings (rejected suggestions alone are not findings)
 * - `bun run lint:tailwind:apply` — write the fixes; exits 0 once applied
 * - `--markdown` — check-only report for CI/PR comments; prints nothing
 * and exits 0 when everything is canonical, exits 1 on findings
 *
 * Companion guard: `check-regressions.ts` (see `regressions.ts`) inspects a
 * PR's diff for hand-applied engine suggestions that fail CSS-equivalence —
 * regressions this tree-based report can't see.
 */
import {analyzeTailwindClasses} from './analyze'
import {applyCanonicalFixes} from './apply'
import {runCli} from './cli'
import {formatCanonicalizeReport} from './report'

if (import.meta.main) {
  await runCli({
    flags: {
      apply: {type: 'boolean', default: false},
      markdown: {type: 'boolean', default: false},
    },
    async run({apply, markdown}) {
      const analysis = await analyzeTailwindClasses()
      const report = formatCanonicalizeReport(analysis)
      const hasFindings = analysis.verified.length > 0

      if (markdown) {
        return {report: report.markdown, hasFindings}
      }

      const lines = [report.text]

      if (apply) {
        const changedFiles = await applyCanonicalFixes(analysis)

        for (const file of changedFiles) lines.push(`updated: ${file}`)
        lines.push(`\napplied to ${changedFiles.length} files`)

        return {report: lines.join('\n'), hasFindings: false}
      }

      lines.push('\n(dry run — pass --apply to write changes)')

      return {report: lines.join('\n'), hasFindings}
    },
  })
}
