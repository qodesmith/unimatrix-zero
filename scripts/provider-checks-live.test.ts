import {describe, expect, it} from 'vitest'

import {liveOutcome, liveTestArgs} from './provider-checks-live.ts'

describe('the live run of provider-checks', () => {
  const args = liveTestArgs('/tmp/report.json')

  it('takes each live check and each test that records, tagged with an id or not, and skips an untagged test', () => {
    const tagged = new RegExp(args[args.indexOf('-t') + 1] ?? '^$')

    expect(
      [
        'a live Claude [dep:prompt-uuid] stores it',
        'a live Claude [records] compacts',
        'a live Claude [records] [dep:claude-sandbox] asks',
        'a live Claude [dep:claude-sandbox] [records] asks',
        'a live Claude forgets a failed Prompt',
      ].filter(name => tagged.test(name))
    ).toEqual([
      'a live Claude [dep:prompt-uuid] stores it',
      'a live Claude [records] compacts',
      'a live Claude [records] [dep:claude-sandbox] asks',
      'a live Claude [dep:claude-sandbox] [records] asks',
    ])
  })

  it('runs a failed test once more', () => {
    expect(args.slice(args.indexOf('--retry')).slice(0, 2)).toEqual([
      '--retry',
      '1',
    ])
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
