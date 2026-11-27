import {describe, expect, it} from 'vitest'

import {LIVE_RUNS, liveOutcome} from './provider-checks-live.ts'

function retriesFor(name: string) {
  return LIVE_RUNS.filter(run => new RegExp(run.pattern).test(name)).map(
    run => run.retry
  )
}

describe('the live runs of provider-checks', () => {
  it('retry a live check once, a test that records never, and skip an untagged test', () => {
    expect(retriesFor('a live Claude [dep:prompt-uuid] stores it')).toEqual([1])
    expect(retriesFor('a live Claude [records] compacts')).toEqual([0])
    expect(
      retriesFor('a live Claude [records] [dep:claude-sandbox] asks')
    ).toEqual([0])
    expect(
      retriesFor('a live Claude [dep:claude-sandbox] [records] asks')
    ).toEqual([0])
    expect(retriesFor('a live Claude forgets a failed Prompt')).toEqual([])
  })
})

describe('the outcome of the live tests', () => {
  const tests = [
    {title: '[dep:steady] [dep:shared] a', status: 'passed'},
    {
      title: '[dep:flaky] b',
      status: 'passed',
      failureMessages: ['AssertionError: the first try'],
    },
    {title: '[dep:shared] c', status: 'failed', failureMessages: ['no']},
    {title: '[dep:skipped] d', status: 'skipped'},
  ]

  it('gives each id the worst status of the tests tagged with it, and not run to one no test ran for', () => {
    expect(
      liveOutcome(['steady', 'flaky', 'shared', 'skipped', 'untagged'], tests)
        .checks
    ).toEqual([
      {id: 'steady', status: 'passed'},
      {id: 'flaky', status: 'passed'},
      {id: 'shared', status: 'failed'},
      {id: 'skipped', status: 'not run'},
      {id: 'untagged', status: 'not run'},
    ])
  })

  it('names the tests that passed only on a retry, and fails only with a failed test', () => {
    expect(liveOutcome([], tests)).toMatchObject({
      retried: ['[dep:flaky] b'],
      failed: true,
    })
    expect(liveOutcome([], tests.slice(0, 2)).failed).toBe(false)
  })
})
