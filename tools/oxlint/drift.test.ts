import {describe, expect, it} from 'vitest'

import {evaluateDrift, formatDriftMarkdown} from './drift'

describe('evaluateDrift', () => {
  it('passes when installed matches both latest and reviewed', () => {
    const verdict = evaluateDrift({
      installed: '1.74.0',
      latest: '1.74.0',
      reviewed: '1.74.0',
    })
    expect(verdict).toEqual({shouldFail: false, reasons: []})
  })

  it('fails when latest is a major version ahead', () => {
    const {shouldFail, reasons} = evaluateDrift({
      installed: '1.74.0',
      latest: '2.0.0',
      reviewed: '1.74.0',
    })
    expect(shouldFail).toBe(true)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('major version behind')
    expect(reasons[0]).toContain('`1.74.0`')
    expect(reasons[0]).toContain('`2.0.0`')
  })

  it('fails when latest is at least 5 minor versions ahead', () => {
    const {shouldFail, reasons} = evaluateDrift({
      installed: '1.74.0',
      latest: '1.79.0',
      reviewed: '1.74.0',
    })
    expect(shouldFail).toBe(true)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('5 minor versions behind')
    expect(reasons[0]).toContain('threshold is 5')
  })

  it('passes when latest is fewer than 5 minor versions ahead', () => {
    const verdict = evaluateDrift({
      installed: '1.74.0',
      latest: '1.78.3',
      reviewed: '1.74.0',
    })
    expect(verdict).toEqual({shouldFail: false, reasons: []})
  })

  it('fails when installed does not match the reviewed version', () => {
    const {shouldFail, reasons} = evaluateDrift({
      installed: '1.74.0',
      latest: '1.74.0',
      reviewed: '1.73.0',
    })
    expect(shouldFail).toBe(true)
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('does not match the reviewed version')
    expect(reasons[0]).toContain('reviewed-oxlint-version.json')
  })

  it('reports drift and review mismatch as separate reasons', () => {
    const {shouldFail, reasons} = evaluateDrift({
      installed: '1.70.0',
      latest: '1.79.0',
      reviewed: '1.68.0',
    })
    expect(shouldFail).toBe(true)
    expect(reasons).toHaveLength(2)
  })

  it('does not flag minor drift across different majors', () => {
    // Major-behind already covers this case; the minor comparison must not
    // also fire (1.79 vs 2.0 would otherwise compute a negative delta).
    const {reasons} = evaluateDrift({
      installed: '1.79.0',
      latest: '2.0.0',
      reviewed: '1.79.0',
    })
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('major version behind')
  })
})

describe('formatDriftMarkdown', () => {
  it('returns an empty string when there are no reasons', () => {
    expect(formatDriftMarkdown([])).toBe('')
  })

  it('wraps reasons in the drift report body', () => {
    const body = formatDriftMarkdown(['**reason one.**', '**reason two.**'])
    expect(body).toContain('## oxlint rule drift detected')
    expect(body).toContain('- **reason one.**')
    expect(body).toContain('- **reason two.**')
    // The workflow concatenates the generated rule-change delta after this
    // heading, so it must come last.
    expect(
      body
        .trimEnd()
        .endsWith('### Rule changes since the last reviewed version')
    ).toBe(true)
  })
})
