import type {TailwindClassAnalysis} from './analyze'

/** Plain-text report for local dry runs. */
export function formatTextReport(analysis: TailwindClassAnalysis): string {
  const lines = [
    `files scanned: ${analysis.filesScanned}, ` +
      `unique tokens: ${analysis.uniqueTokens}`,
    '',
    `=== VERIFIED MAPPING (${analysis.verified.length}) ===`,
  ]

  for (const {from, to, locations} of analysis.verified) {
    lines.push(`${from} => ${to}`)

    for (const loc of locations) lines.push(`  at ${loc.file}:${loc.line}`)
  }

  if (analysis.rejected.length > 0) {
    lines.push('', `=== REJECTED (${analysis.rejected.length}) ===`)

    for (const r of analysis.rejected) {
      lines.push(`${r.from} => ${r.to}`, `  ${r.reason}`)
    }
  }

  return lines.join('\n')
}

/**
 * Markdown report for CI/PR comments. Returns an empty string when there is
 * nothing actionable (rejected pairs alone need no action — they are engine
 * suggestions the CSS-equivalence verifier refused).
 */
export function formatMarkdownReport(analysis: TailwindClassAnalysis): string {
  if (analysis.verified.length === 0) return ''

  const lines = [
    '### Non-canonical Tailwind classes',
    '',
    `${analysis.verified.length} class(es) can be written in canonical form:`,
    '',
    '| Current | Canonical | Locations |',
    '| --- | --- | --- |',
  ]

  for (const {from, to, locations} of analysis.verified) {
    const where = locations
      .map(loc => `\`${loc.file}:${loc.line}\``)
      .join('<br>')
    lines.push(`| \`${from}\` | \`${to}\` | ${where} |`)
  }

  lines.push(
    '',
    'Fix locally: `bun tools/tailwind/canonicalize-classes.ts --apply`'
  )

  if (analysis.rejected.length > 0) {
    lines.push(
      '',
      '<details>',
      `<summary>${analysis.rejected.length} suggestion(s) rejected by ` +
        'CSS-equivalence verification — no action needed</summary>',
      '',
      '```',
      ...analysis.rejected.map(r => `${r.from} => ${r.to}\n  ${r.reason}`),
      '```',
      '',
      '</details>'
    )
  }

  return lines.join('\n')
}
