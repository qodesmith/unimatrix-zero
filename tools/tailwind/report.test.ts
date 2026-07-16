import type {
  CanonicalPair,
  RejectedPair,
  TailwindClassAnalysis,
} from './analyze'

import {describe, expect, it} from 'vitest'

import {formatMarkdownReport, formatTextReport} from './report'

function makeAnalysis(
  verified: CanonicalPair[],
  rejected: RejectedPair[] = []
): TailwindClassAnalysis {
  return {
    projectRoot: '/proj',
    filesScanned: 3,
    uniqueTokens: 12,
    verified,
    rejected,
    edits: [],
    literals: [],
    fileTexts: new Map(),
  }
}

const pair: CanonicalPair = {
  from: 'w-[16px]',
  to: 'w-4',
  locations: [
    {file: 'src/a.tsx', line: 5},
    {file: 'src/b.tsx', line: 9},
  ],
}

const rejectedPair: RejectedPair = {
  from: 'rounded-[4px]',
  to: 'rounded-sm',
  reason: 'css mismatch:\n  OLD: x\n  NEW: y',
}

describe('formatTextReport', () => {
  it('lists counts, the mapping, and each location', () => {
    const report = formatTextReport(makeAnalysis([pair]))

    expect(report).toBe(
      [
        'files scanned: 3, unique tokens: 12',
        '',
        '=== VERIFIED MAPPING (1) ===',
        'w-[16px] => w-4',
        '  at src/a.tsx:5',
        '  at src/b.tsx:9',
      ].join('\n')
    )
  })

  it('omits the rejected section when nothing was rejected', () => {
    expect(formatTextReport(makeAnalysis([pair]))).not.toContain('REJECTED')
  })

  it('appends rejected pairs with their reasons', () => {
    const report = formatTextReport(makeAnalysis([pair], [rejectedPair]))

    expect(report).toContain('=== REJECTED (1) ===')
    expect(report).toContain('rounded-[4px] => rounded-sm')
    expect(report).toContain('css mismatch')
  })

  it('still reports counts when everything is canonical', () => {
    expect(formatTextReport(makeAnalysis([]))).toBe(
      [
        'files scanned: 3, unique tokens: 12',
        '',
        '=== VERIFIED MAPPING (0) ===',
      ].join('\n')
    )
  })
})

describe('formatMarkdownReport', () => {
  it('returns an empty string when nothing is actionable', () => {
    expect(formatMarkdownReport(makeAnalysis([]))).toBe('')

    // Rejected pairs alone need no action.
    expect(formatMarkdownReport(makeAnalysis([], [rejectedPair]))).toBe('')
  })

  it('renders a table row per pair with <br>-joined locations', () => {
    const report = formatMarkdownReport(makeAnalysis([pair]))

    expect(report).toContain('### Non-canonical Tailwind classes')
    expect(report).toContain('1 class(es) can be written in canonical form:')
    expect(report).toContain('| Current | Canonical | Locations |')
    expect(report).toContain(
      '| `w-[16px]` | `w-4` | `src/a.tsx:5`<br>`src/b.tsx:9` |'
    )
    expect(report).toContain(
      'Fix locally: `bun tools/tailwind/canonicalize-classes.ts --apply`'
    )
  })

  it('omits the details block when nothing was rejected', () => {
    expect(formatMarkdownReport(makeAnalysis([pair]))).not.toContain(
      '<details>'
    )
  })

  it('collapses rejected pairs into a details block', () => {
    const report = formatMarkdownReport(makeAnalysis([pair], [rejectedPair]))

    expect(report).toContain('<details>')
    expect(report).toContain(
      '1 suggestion(s) rejected by CSS-equivalence verification'
    )
    expect(report).toContain('rounded-[4px] => rounded-sm')
    expect(report).toContain('</details>')
  })
})
