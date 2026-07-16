import {describe, expect, it} from 'vitest'

import {formatFindings} from './findings'

const spec = {
  title: 'Non-canonical Tailwind classes',
  intro: (count: number) =>
    `${count} class(es) can be written in canonical form:`,
}

describe('formatFindings', () => {
  it('owns the clean convention: no findings → empty markdown', () => {
    expect(formatFindings(spec, [])).toEqual({text: '', markdown: ''})
  })

  it('reports a clean run in text mode via emptyText', () => {
    const report = formatFindings(
      {...spec, emptyText: 'all classes are canonical'},
      []
    )

    expect(report.text).toBe('all classes are canonical')
    expect(report.markdown).toBe('')
  })

  it('renders a located finding with a reason on both surfaces', () => {
    const report = formatFindings(spec, [
      {
        file: 'src/box.tsx',
        from: 'rounded-[4px]',
        to: 'rounded-lg',
        reason: 'css mismatch',
      },
    ])

    expect(report.markdown).toBe(
      [
        '### Non-canonical Tailwind classes',
        '',
        '1 class(es) can be written in canonical form:',
        '',
        '| Change | Where | Why |',
        '| --- | --- | --- |',
        '| `rounded-[4px]` → `rounded-lg` | `src/box.tsx` | `css mismatch` |',
      ].join('\n')
    )
    expect(report.text).toBe(
      [
        '=== NON-CANONICAL TAILWIND CLASSES (1) ===',
        'rounded-[4px] => rounded-lg',
        '  at src/box.tsx',
        '  css mismatch',
      ].join('\n')
    )
  })

  it('groups occurrences of the same rewrite into one finding', () => {
    const report = formatFindings(spec, [
      {file: 'src/a.tsx:5', from: 'w-[16px]', to: 'w-4'},
      {file: 'src/b.tsx:9', from: 'w-[16px]', to: 'w-4'},
    ])

    expect(report.markdown).toContain(
      '1 class(es) can be written in canonical form:'
    )
    expect(report.markdown).toContain(
      '| `w-[16px]` → `w-4` | `src/a.tsx:5`<br>`src/b.tsx:9` |'
    )
    expect(report.text).toContain('=== NON-CANONICAL TAILWIND CLASSES (1) ===')
    expect(report.text).toContain(
      ['w-[16px] => w-4', '  at src/a.tsx:5', '  at src/b.tsx:9'].join('\n')
    )
  })

  it('renders a multi-line reason line by line', () => {
    const report = formatFindings(spec, [
      {
        file: 'src/box.tsx',
        from: 'rounded-[4px]',
        to: 'rounded-lg',
        reason: 'css mismatch:\n  OLD: a\n  NEW: b',
      },
    ])

    expect(report.markdown).toContain(
      '| `css mismatch:`<br>`OLD: a`<br>`NEW: b` |'
    )
    expect(report.text).toContain(
      ['  css mismatch:', '  OLD: a', '  NEW: b'].join('\n')
    )
  })

  it('drops the Why column when no finding has a reason', () => {
    const report = formatFindings(spec, [
      {file: 'src/a.tsx:5', from: 'w-[16px]', to: 'w-4'},
    ])

    expect(report.markdown).toContain('| Change | Where |')
    expect(report.markdown).toContain('| `w-[16px]` → `w-4` | `src/a.tsx:5` |')
    expect(report.markdown).not.toContain('Why')
  })

  it('drops the Where column when no finding is located', () => {
    const report = formatFindings(spec, [
      {from: '1.74.0', to: '2.0.0', reason: 'oxlint is a major version behind'},
    ])

    expect(report.markdown).toContain('| Change | Why |')
    expect(report.markdown).toContain(
      '| `1.74.0` → `2.0.0` | `oxlint is a major version behind` |'
    )
    expect(report.markdown).not.toContain('Where')
    expect(report.text).toBe(
      [
        '=== NON-CANONICAL TAILWIND CLASSES (1) ===',
        '1.74.0 => 2.0.0',
        '  oxlint is a major version behind',
      ].join('\n')
    )
  })

  it('ends the markdown with the footer so callers can concatenate after it', () => {
    const report = formatFindings(
      {
        ...spec,
        footer: '---\n\n### Rule changes since the last reviewed version',
      },
      [{from: '1.74.0', to: '2.0.0', reason: 'behind'}]
    )

    expect(
      report.markdown.endsWith(
        '\n---\n\n### Rule changes since the last reviewed version'
      )
    ).toBe(true)

    // The footer is CI/PR-comment plumbing, not part of the local report.
    expect(report.text).not.toContain('Rule changes')
  })

  const appendix = {
    summary: (count: number) =>
      `${count} suggestion(s) rejected by CSS-equivalence verification` +
      ' — no action needed',
    findings: [
      {from: 'rounded-[4px]', to: 'rounded-sm', reason: 'css mismatch'},
    ],
  }

  it('collapses appendix findings into a details block in markdown', () => {
    const report = formatFindings({...spec, appendix}, [
      {file: 'src/a.tsx:5', from: 'w-[16px]', to: 'w-4'},
    ])

    expect(report.markdown).toContain(
      [
        '<details>',
        '<summary>1 suggestion(s) rejected by CSS-equivalence verification' +
          ' — no action needed</summary>',
        '',
        '```',
        'rounded-[4px] => rounded-sm',
        '  css mismatch',
        '```',
        '',
        '</details>',
      ].join('\n')
    )
    expect(report.text).toContain(
      [
        '1 suggestion(s) rejected by CSS-equivalence verification' +
          ' — no action needed:',
        'rounded-[4px] => rounded-sm',
        '  css mismatch',
      ].join('\n')
    )
  })

  it('appendix findings alone are not actionable: markdown stays clean', () => {
    const report = formatFindings(
      {...spec, emptyText: 'all classes are canonical', appendix},
      []
    )

    expect(report.markdown).toBe('')

    // Local runs still surface them — they explain why nothing was rewritten.
    expect(report.text).toContain('all classes are canonical')
    expect(report.text).toContain('rounded-[4px] => rounded-sm')
  })
})
