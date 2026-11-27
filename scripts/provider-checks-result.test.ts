import type {Result} from './provider-checks-result.ts'

import {describe, expect, it} from 'vitest'

import {gateVerdict, renderResult} from './provider-checks-result.ts'

const OWNER = 'qodesmith'
const HEAD = 'c0ffee1'

function result(head: string | null, change: Partial<Result> = {}): Result {
  return {
    head,
    pinChanges: ['claude 2.1.307 → 2.1.322'],
    checks: [
      {id: 'synthetic-marker', status: 'passed'},
      {id: 'prompt-uuid', status: 'passed'},
    ],
    reviews: [
      {id: 'synthetic-marker', verdict: 'holds', reason: ''},
      {id: 'cut-short-replies', verdict: 'holds', reason: ''},
    ],
    retried: [],
    gatedFiles: [],
    whyKept: null,
    everydayTests: 'passed',
    ...change,
  }
}

const passing = renderResult(result(HEAD))

const failingCheck = renderResult(
  result(HEAD, {
    checks: [
      {id: 'synthetic-marker', status: 'failed'},
      {id: 'prompt-uuid', status: 'passed'},
    ],
  })
)

const unrun = renderResult(
  result(HEAD, {checks: [{id: 'synthetic-marker', status: 'not run'}]})
)

const stale = renderResult(
  result(HEAD, {
    reviews: [
      {
        id: 'cut-short-replies',
        verdict: 'stale',
        reason: 'Codex no longer writes <turn_aborted>.',
      },
    ],
  })
)

const unreviewed = renderResult(
  result(HEAD, {
    reviews: [{id: 'cut-short-replies', verdict: 'not reviewed', reason: ''}],
  })
)

const NOT_NEEDED = {
  id: 'cut-short-replies',
  verdict: 'not needed',
  reason: 'no pin moved',
} as const

const noPinMoved = result(HEAD, {
  pinChanges: [],
  reviews: [
    NOT_NEEDED,
    {id: 'synthetic-marker', verdict: 'holds', reason: ''},
    {...NOT_NEEDED, id: 'prompt-uuid'},
  ],
})

const kept = renderResult(result(HEAD, {whyKept: 'a live test failed'}))

const everydayFailed = renderResult(result(HEAD, {everydayTests: 'failed'}))

function verdict(...comments: [login: string, body: string][]) {
  return gateVerdict({
    owner: OWNER,
    head: HEAD,
    comments: comments.map(([login, body]) => ({login, body})),
  }).pass
}

describe('the provider-checks gate on a PR it holds', () => {
  it('passes on the owner’s passing result for the head commit', () => {
    expect(verdict(['someone', 'LGTM'], [OWNER, passing])).toBe(true)
  })

  it('fails with no result', () => {
    expect(verdict(['someone', 'LGTM'], [OWNER, 'Looks fine to me.'])).toBe(
      false
    )
  })

  it('fails on a passing result anyone but the owner posted', () => {
    expect(verdict(['qodesmith-fan', passing], ['someone', passing])).toBe(
      false
    )
  })

  it('fails on the owner’s passing result for an earlier commit', () => {
    expect(verdict([OWNER, renderResult(result('older12'))])).toBe(false)
  })

  it('fails on a result with a failing check, a check that didn’t run, a stale entry or one not reviewed', () => {
    expect(verdict([OWNER, failingCheck])).toBe(false)
    expect(verdict([OWNER, unrun])).toBe(false)
    expect(verdict([OWNER, stale])).toBe(false)
    expect(verdict([OWNER, unreviewed])).toBe(false)
  })

  it('passes with reviews not needed when no pin moved, counting them on the Review line with no row each', () => {
    const body = renderResult(noPinMoved)

    expect(verdict([OWNER, body])).toBe(true)
    expect(body).toContain('**Review:** 1 holds, 2 not needed: no pin moved\n')
    expect(body).not.toContain('| `cut-short-replies` |')
  })

  it('fails on a review not needed when a pin moved', () => {
    const bump = renderResult(
      result(HEAD, {...noPinMoved, pinChanges: ['claude 2.1.307 → 2.1.322']})
    )

    expect(verdict([OWNER, bump])).toBe(false)
  })

  it('passes on a result with a live test that passed on a retry, and names the test', () => {
    const retried = renderResult(
      result(HEAD, {retried: ['[dep:prompt-uuid] stores <synthetic>']})
    )

    expect(verdict([OWNER, retried])).toBe(true)
    expect(retried).toContain(
      '**Passed on a retry:** 1\n\n- [dep:prompt-uuid] stores &lt;synthetic>\n'
    )
    expect(passing).not.toContain('Passed on a retry')
  })

  it('fails on a result that kept the old recordings, or whose everyday tests failed against the new ones', () => {
    expect(verdict([OWNER, kept])).toBe(false)
    expect(verdict([OWNER, everydayFailed])).toBe(false)
  })

  it('goes by the owner’s newest result for the head commit', () => {
    expect(verdict([OWNER, passing], [OWNER, stale])).toBe(false)
    expect(verdict([OWNER, stale], [OWNER, passing])).toBe(true)
  })

  it('ignores a garbled result', () => {
    expect(
      verdict(
        [OWNER, passing],
        [OWNER, '<!-- provider-checks {"head": c0ffee1} -->']
      )
    ).toBe(true)
  })

  it('finds no result in a run with no PR to post on', () => {
    expect(
      verdict([OWNER, renderResult(result(null))], [OWNER, `For ${HEAD}.`])
    ).toBe(false)
  })
})
