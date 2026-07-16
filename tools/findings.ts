/**
 * The one findings-report vocabulary for every tool that flags rewrites:
 * a flow produces `Finding`s, this module renders them for both surfaces —
 * plain text for local runs, markdown for CI/PR comments — and owns the
 * clean-report convention: an empty markdown string means "clean, post no
 * PR comment". Callers: the tailwind canonicalize and regression flows and
 * the oxlint drift check.
 */

export interface Finding {
  /** Where to act (`src/a.tsx:5`, `package.json`), when located. */
  file?: string

  /** The value as it exists now. */
  from: string

  /** The value it should be. */
  to: string

  /** Why this was flagged; may span lines. Omitted when self-evident. */
  reason?: string
}

export interface FindingsReport {
  /** Local-run report; `emptyText` when there are no findings. */
  text: string

  /** CI/PR-comment report; empty string when there are no findings. */
  markdown: string
}

export interface FindingsSpec {
  /** Report heading — `### <title>` in markdown, `=== TITLE (n) ===` in text. */
  title: string

  /** Copy between the heading and the findings, given the finding count. */
  intro: (count: number) => string

  /** Text-report body when there are no findings. */
  emptyText?: string

  /**
   * CI/PR-comment plumbing appended after the findings, markdown only —
   * e.g. how to fix locally, or a trailing heading the workflow
   * concatenates generated content after. Always last in the markdown.
   */
  footer?: string

  /**
   * Findings that need no action but explain the run (e.g. suggestions the
   * verifier refused). Collapsed into a `<details>` block in markdown —
   * never actionable on their own, so they don't stop a report from being
   * clean — and always listed in text, where they matter for local runs.
   */
  appendix?: {summary: (count: number) => string; findings: Finding[]}
}

interface FindingGroup {
  from: string
  to: string
  reason: string
  files: string[]
}

/**
 * Occurrences of the same rewrite (same from/to/reason) are one finding
 * seen in several places — merge their locations, first-seen order.
 */
function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>()

  for (const {file, from, to, reason = ''} of findings) {
    const key = JSON.stringify([from, to, reason])
    const group = groups.get(key) ?? {from, to, reason, files: []}

    if (file) group.files.push(file)
    groups.set(key, group)
  }

  return [...groups.values()]
}

function reasonLines(reason: string): string[] {
  return reason.split('\n').map(line => line.trim())
}

/** One text entry per group: the rewrite, its locations, its reason. */
function textEntries(groups: FindingGroup[]): string[] {
  return groups.flatMap(g => [
    `${g.from} => ${g.to}`,
    ...g.files.map(file => `  at ${file}`),
    ...(g.reason ? reasonLines(g.reason).map(line => `  ${line}`) : []),
  ])
}

export function formatFindings(
  spec: FindingsSpec,
  findings: Finding[]
): FindingsReport {
  const appendixGroups = groupFindings(spec.appendix?.findings ?? [])
  const appendixTextBlock =
    spec.appendix && appendixGroups.length > 0
      ? [
          `${spec.appendix.summary(appendixGroups.length)}:`,
          ...textEntries(appendixGroups),
        ].join('\n')
      : ''

  if (findings.length === 0) {
    return {
      text: [spec.emptyText ?? '', appendixTextBlock]
        .filter(Boolean)
        .join('\n\n'),
      markdown: '',
    }
  }

  const groups = groupFindings(findings)

  // Columns adapt to the findings: a flow whose findings are never located
  // (or never need explaining) doesn't pay for an empty column.
  const columns: [string, (g: FindingGroup) => string][] = [
    ['Change', g => `\`${g.from}\` → \`${g.to}\``],
  ]

  if (groups.some(g => g.files.length > 0)) {
    columns.push(['Where', g => g.files.map(f => `\`${f}\``).join('<br>')])
  }

  if (groups.some(g => g.reason !== '')) {
    columns.push([
      'Why',
      g =>
        reasonLines(g.reason)
          .map(line => `\`${line}\``)
          .join('<br>'),
    ])
  }

  const row = (cells: string[]) => `| ${cells.join(' | ')} |`

  const appendixMarkdownBlock =
    spec.appendix && appendixGroups.length > 0
      ? [
          '<details>',
          `<summary>${spec.appendix.summary(appendixGroups.length)}</summary>`,
          '',
          '```',
          ...textEntries(appendixGroups),
          '```',
          '',
          '</details>',
        ].join('\n')
      : ''

  const markdown = [
    `### ${spec.title}`,
    spec.intro(groups.length),
    [
      row(columns.map(([header]) => header)),
      row(columns.map(() => '---')),
      ...groups.map(g => row(columns.map(([, cell]) => cell(g)))),
    ].join('\n'),
    appendixMarkdownBlock,
    spec.footer ?? '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const text = [
    [
      `=== ${spec.title.toUpperCase()} (${groups.length}) ===`,
      ...textEntries(groups),
    ].join('\n'),
    appendixTextBlock,
  ]
    .filter(Boolean)
    .join('\n\n')

  return {text, markdown}
}
