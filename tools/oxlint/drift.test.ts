import {describe, expect, it} from 'vitest'

import {evaluateDrift, formatDriftReport} from './drift'

describe('evaluateDrift', () => {
  it('passes when installed matches both latest and reviewed', () => {
    const verdict = evaluateDrift({
      installed: '1.74.0',
      latest: '1.74.0',
      reviewed: '1.74.0',
    })
    expect(verdict).toEqual({shouldFail: false, findings: []})
  })

  it('fails when latest is a major version ahead', () => {
    const {shouldFail, findings} = evaluateDrift({
      installed: '1.74.0',
      latest: '2.0.0',
      reviewed: '1.74.0',
    })
    expect(shouldFail).toBe(true)
    expect(findings).toEqual([
      {
        file: 'package.json',
        from: '1.74.0',
        to: '2.0.0',
        reason: 'oxlint is a major version behind the latest published release',
      },
    ])
  })

  it('fails when latest is at least 5 minor versions ahead', () => {
    const {shouldFail, findings} = evaluateDrift({
      installed: '1.74.0',
      latest: '1.79.0',
      reviewed: '1.74.0',
    })
    expect(shouldFail).toBe(true)
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toContain('5 minor versions behind')
    expect(findings[0].reason).toContain('threshold is 5')
  })

  it('passes when latest is fewer than 5 minor versions ahead', () => {
    const verdict = evaluateDrift({
      installed: '1.74.0',
      latest: '1.78.3',
      reviewed: '1.74.0',
    })
    expect(verdict).toEqual({shouldFail: false, findings: []})
  })

  it('fails when installed does not match the reviewed version', () => {
    const {shouldFail, findings} = evaluateDrift({
      installed: '1.74.0',
      latest: '1.74.0',
      reviewed: '1.73.0',
    })
    expect(shouldFail).toBe(true)
    expect(findings).toEqual([
      {
        file: 'tools/oxlint/reviewed-oxlint-version.json',
        from: '1.73.0',
        to: '1.74.0',
        reason:
          'installed oxlint does not match the reviewed version — review ' +
          'the rule changes below, then set the reviewed version to 1.74.0',
      },
    ])
  })

  it('reports drift and review mismatch as separate findings', () => {
    const {shouldFail, findings} = evaluateDrift({
      installed: '1.70.0',
      latest: '1.79.0',
      reviewed: '1.68.0',
    })
    expect(shouldFail).toBe(true)
    expect(findings).toHaveLength(2)
  })

  it('does not flag minor drift across different majors', () => {
    // Major-behind already covers this case; the minor comparison must not
    // also fire (1.79 vs 2.0 would otherwise compute a negative delta).
    const {findings} = evaluateDrift({
      installed: '1.79.0',
      latest: '2.0.0',
      reviewed: '1.79.0',
    })
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toContain('major version behind')
  })
})

describe('formatDriftReport', () => {
  it('is clean when there are no findings', () => {
    const report = formatDriftReport([])

    expect(report.markdown).toBe('')
    expect(report.text).toBe('oxlint is in sync — no drift detected.')
  })

  it('renders each finding and ends with the rule-changes heading', () => {
    const {markdown} = formatDriftReport(
      evaluateDrift({
        installed: '1.70.0',
        latest: '1.79.0',
        reviewed: '1.68.0',
      }).findings
    )

    expect(markdown).toContain('### oxlint rule drift detected')
    expect(markdown).toContain('2 requirement(s) failed:')
    expect(markdown).toContain('| `1.70.0` → `1.79.0` | `package.json` |')
    expect(markdown).toContain(
      '| `1.68.0` → `1.70.0` | `tools/oxlint/reviewed-oxlint-version.json` |'
    )
    // The workflow concatenates the generated rule-change delta after this
    // heading, so it must come last.
    expect(
      markdown
        .trimEnd()
        .endsWith('### Rule changes since the last reviewed version')
    ).toBe(true)
  })
})
