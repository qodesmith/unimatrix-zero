import type {Finding, FindingsReport} from '../findings'
import type {TailwindClassAnalysis} from './analyze'

import {formatFindings} from '../findings'

/**
 * Renders the canonicalize analysis through the shared findings module:
 * text for local dry runs, markdown for CI/PR comments. The markdown is
 * empty when there is nothing actionable — rejected pairs alone need no
 * action (they are engine suggestions the CSS-equivalence verifier
 * refused), so they ride along as the report's appendix.
 */
export function formatCanonicalizeReport(
  analysis: TailwindClassAnalysis
): FindingsReport {
  const findings: Finding[] = analysis.verified.flatMap(
    ({from, to, locations}) =>
      locations.map(loc => ({file: `${loc.file}:${loc.line}`, from, to}))
  )

  const report = formatFindings(
    {
      title: 'Non-canonical Tailwind classes',
      intro: count => `${count} class(es) can be written in canonical form:`,
      emptyText: 'all classes are canonical',
      footer: 'Fix locally: `bun run lint:tailwind:apply`',
      appendix: {
        summary: count =>
          `${count} suggestion(s) rejected by CSS-equivalence ` +
          'verification — no action needed',
        findings: analysis.rejected,
      },
    },
    findings
  )

  const stats =
    `files scanned: ${analysis.filesScanned}, ` +
    `unique tokens: ${analysis.uniqueTokens}`

  return {text: `${stats}\n\n${report.text}`, markdown: report.markdown}
}
