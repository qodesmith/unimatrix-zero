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

function verdict(...comments: [login: string, body: string][]) {
  return gateVerdict({
    owner: OWNER,
    head: HEAD,
    comments: comments.map(([login, body]) => ({login, body})),
  }).pass
}

describe('the provider-checks gate on a bump PR', () => {
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
