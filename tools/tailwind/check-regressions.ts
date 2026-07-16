/**
 * CI guard for hand-applied canonicalization regressions — the companion to
 * `canonicalize-classes.ts` that inspects the *diff* rather than the tree
 * (see `regressions.ts` for why the tree alone can't catch these).
 *
 * CLI (see `cli.ts` for the shared flag parsing and exit contract):
 *
 * - `bun run lint:tailwind:regressions` — text report vs origin/main
 * - `--base <ref>` — explicit base
 * - `--markdown` — CI/PR-comment report; prints nothing when the diff is clean
 *
 * Exits 1 when regressions are found — the same contract as the
 * canonical-classes report.
 */
import {runCli} from './cli'
import {findCanonicalRegressions, formatRegressionsReport} from './regressions'

if (import.meta.main) {
  await runCli({
    flags: {
      markdown: {type: 'boolean', default: false},
      base: {type: 'string'},
    },
    async run({markdown, base}) {
      const regressions = await findCanonicalRegressions({baseRef: base})
      const report = formatRegressionsReport(regressions)

      return {
        report: markdown ? report.markdown : report.text,
        hasFindings: regressions.length > 0,
      }
    },
  })
}
