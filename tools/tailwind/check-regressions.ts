/**
 * CI guard for hand-applied canonicalization regressions — the companion to
 * `canonicalize-classes.ts` that inspects the *diff* rather than the tree
 * (see `regressions.ts` for why the tree alone can't catch these).
 *
 * CLI (run from the project root):
 *
 * - `bun tools/tailwind/check-regressions.ts` — text report vs origin/main
 * - `bun tools/tailwind/check-regressions.ts --base <ref>` — explicit base
 * - `bun tools/tailwind/check-regressions.ts --markdown` — CI/PR-comment report;
 *   prints nothing when the diff is clean
 *
 * Exits 1 when regressions are found — blocking by design, unlike the
 * canonical-classes report.
 */
import {
  findCanonicalRegressions,
  formatRegressionsMarkdown,
  formatRegressionsText,
} from './regressions'

export {
  findCanonicalRegressions,
  formatRegressionsMarkdown,
  formatRegressionsText,
} from './regressions'

if (import.meta.main) {
  const markdown = Bun.argv.includes('--markdown')
  const baseIndex = Bun.argv.indexOf('--base')
  const baseRef = baseIndex === -1 ? undefined : Bun.argv[baseIndex + 1]

  if (baseIndex !== -1 && !baseRef) {
    throw new Error('--base requires a git ref')
  }

  const regressions = await findCanonicalRegressions({baseRef})

  /* oxlint-disable no-console */
  if (markdown) {
    const report = formatRegressionsMarkdown(regressions)
    if (report) console.log(report)
  } else {
    console.log(formatRegressionsText(regressions))
  }
  /* oxlint-enable no-console */

  process.exitCode = regressions.length > 0 ? 1 : 0
}
