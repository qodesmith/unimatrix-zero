import type {Result, Since} from './provider-checks-result.ts'

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

const NOTHING_SINCE: Since = {ancestor: true, causes: []}

async function gate(
  comments: [login: string, body: string][],
  since: Record<string, Since> = {}
) {
  const asked: string[] = []

  const answer = await gateVerdict({
    owner: OWNER,
    head: HEAD,
    comments: comments.map(([login, body]) => ({login, body})),
    changesSince: async commit => {
      asked.push(commit)

      return since[commit] ?? NOTHING_SINCE
    },
  })

  return {...answer, asked}
}

async function verdict(...comments: [login: string, body: string][]) {
  return (await gate(comments)).pass
}

describe('the provider-checks gate on a PR it holds', () => {
  it('passes on the owner’s passing result for the head commit', async () => {
    expect(await verdict(['someone', 'LGTM'], [OWNER, passing])).toBe(true)
  })

  it('fails with no result', async () => {
    expect(
      await verdict(['someone', 'LGTM'], [OWNER, 'Looks fine to me.'])
    ).toBe(false)
  })

  it('fails on a passing result anyone but the owner posted', async () => {
    expect(
      await verdict(['qodesmith-fan', passing], ['someone', passing])
    ).toBe(false)
  })

  it('carries the owner’s passing result for an earlier commit over a push that needs no new run, naming that commit', async () => {
    const {pass, reason, asked} = await gate([
      [OWNER, renderResult(result('older12'))],
    ])

    expect(pass).toBe(true)
    expect(asked).toEqual(['older12'])
    expect(reason).toBe(
      `${OWNER}'s provider-checks passed on older12, and nothing since needs a new run, so that result carries over to ${HEAD}.`
    )
  })

  it('asks for a new run when a push since the result changes a file a live test runs, naming each file and why', async () => {
    const {pass, reason} = await gate(
      [[OWNER, renderResult(result('older12'))]],
      {
        older12: {
          ancestor: true,
          causes: [
            {file: 'a/streaming.live.test.ts', why: 'a live test'},
            {file: 'bun.lock', why: 'the lockfile'},
          ],
        },
      }
    )

    expect(pass).toBe(false)
    expect(reason).toBe(
      [
        `${OWNER}'s provider-checks passed on older12, but these changes since need a new run:`,
        '  a/streaming.live.test.ts: a live test',
        '  bun.lock: the lockfile',
        `Check out ${HEAD} and run \`bun run provider-checks\`.`,
      ].join('\n')
    )
  })

  it('doesn’t carry over a result whose commit is no longer in the PR’s history', async () => {
    const {pass, reason} = await gate(
      [[OWNER, renderResult(result('older12'))]],
      {older12: {ancestor: false}}
    )

    expect(pass).toBe(false)
    expect(reason).toBe(
      `${OWNER}'s provider-checks passed on older12, which is no longer in this PR's history. Check out ${HEAD} and run \`bun run provider-checks\`.`
    )
  })

  it('carries over only the owner’s newest result, when it passed and no result names the head commit', async () => {
    const olderPassing = renderResult(result('older12'))
    const olderFailing = renderResult(result('older34', {whyKept: 'x'}))

    const newestFailed = await gate([
      [OWNER, olderPassing],
      [OWNER, olderFailing],
    ])

    expect(newestFailed.pass).toBe(false)
    expect(newestFailed.reason).toBe(
      `${OWNER}'s provider-checks on older34 found a failing check, a stale entry, a recording it kept or a failing everyday test.`
    )
    expect(newestFailed.asked).toEqual([])

    const headFailed = await gate([
      [OWNER, stale],
      [OWNER, olderPassing],
    ])

    expect(headFailed.pass).toBe(false)
    expect(headFailed.asked).toEqual([])
  })

  it('fails on a result with a failing check, a check that didn’t run, a stale entry or one not reviewed', async () => {
    expect(await verdict([OWNER, failingCheck])).toBe(false)
    expect(await verdict([OWNER, unrun])).toBe(false)
    expect(await verdict([OWNER, stale])).toBe(false)
    expect(await verdict([OWNER, unreviewed])).toBe(false)
  })

  it('passes with reviews not needed when no pin moved, counting them on the Review line with no row each', async () => {
    const body = renderResult(noPinMoved)

    expect(await verdict([OWNER, body])).toBe(true)
    expect(body).toContain('**Review:** 1 holds, 2 not needed: no pin moved\n')
    expect(body).not.toContain('| `cut-short-replies` |')
  })

  it('fails on a review not needed when a pin moved', async () => {
    const bump = renderResult(
      result(HEAD, {...noPinMoved, pinChanges: ['claude 2.1.307 → 2.1.322']})
    )

    expect(await verdict([OWNER, bump])).toBe(false)
  })

  it('passes on a result with a live test that passed on a retry, and names the test', async () => {
    const retried = renderResult(
      result(HEAD, {retried: ['[dep:prompt-uuid] stores <synthetic>']})
    )

    expect(await verdict([OWNER, retried])).toBe(true)
    expect(retried).toContain(
      '**Passed on a retry:** 1\n\n- [dep:prompt-uuid] stores &lt;synthetic>\n'
    )
    expect(passing).not.toContain('Passed on a retry')
  })

  it('fails on a result that kept the old recordings, or whose everyday tests failed against the new ones', async () => {
    expect(await verdict([OWNER, kept])).toBe(false)
    expect(await verdict([OWNER, everydayFailed])).toBe(false)
  })

  it('goes by the owner’s newest result for the head commit', async () => {
    expect(await verdict([OWNER, passing], [OWNER, stale])).toBe(false)
    expect(await verdict([OWNER, stale], [OWNER, passing])).toBe(true)
  })

  it('ignores a garbled result', async () => {
    expect(
      await verdict(
        [OWNER, passing],
        [OWNER, '<!-- provider-checks {"head": c0ffee1} -->']
      )
    ).toBe(true)
  })

  it('finds no result in a run with no PR to post on', async () => {
    expect(
      await verdict(
        [OWNER, renderResult(result(null))],
        [OWNER, `For ${HEAD}.`]
      )
    ).toBe(false)
  })
})
