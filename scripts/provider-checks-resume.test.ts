import type {Checkout, LiveTest, SavedRun} from './provider-checks-resume.ts'

import {describe, expect, it} from 'vitest'

import {
  EVERY_LIVE_TEST,
  checksOf,
  mergedLive,
  mergedReviews,
  rerunOf,
  savedRunOf,
  unrewrittenSince,
  whyNotResumable,
} from './provider-checks-resume.ts'
import {entriesOf} from './provider-dependencies.ts'

const HEAD = 'c0ffee1'
const CLAUDE = 'app/provider-host/src/modules/claude-driver'
const LIVE = `${CLAUDE}/streaming.live.test.ts`
const STARTED = `${CLAUDE}/recordings/started.ndjson`
const STOPPED = `${CLAUDE}/recordings/stopped.ndjson`

function entry(
  id: string,
  check = `\`[dep:${id}]\` in streaming.live.test.ts`
) {
  return [
    `### ${id}`,
    `- **Id:** \`${id}\``,
    '- **Relies on:** claude streams.',
    `- **Check:** ${check}`,
  ].join('\n')
}

function listOf(entries: string[], top = '# Provider dependencies') {
  return `${top}\n\n## Entries\n\n${entries.join('\n\n')}\n`
}

const LIST = listOf([
  entry('stream-order'),
  entry('cut-short'),
  entry('self-updates-off', 'none: a setting'),
])

function test(title: string, status: string): LiveTest {
  return {file: LIVE, title, status}
}

const PASSING_TESTS = [
  test('[records] [dep:stream-order] streams a Reply', 'passed'),
  test('[dep:cut-short] stops a Reply', 'passed'),
  test('[records] compacts on its own', 'passed'),
]

function saved(change: Partial<SavedRun> = {}): SavedRun {
  return {
    version: 1,
    pr: 7,
    head: HEAD,
    startedAt: 1000,
    pins: [
      ['claude', '2.1.322'],
      ['codex', '0.163.0'],
    ],
    builds: {claudeProgram: '/vendor/claude', codexFolder: '/vendor/codex'},
    list: LIST,
    live: {tests: PASSING_TESTS, failed: false},
    reviews: [
      {id: 'stream-order', verdict: 'holds', reason: ''},
      {id: 'cut-short', verdict: 'holds', reason: ''},
      {id: 'self-updates-off', verdict: 'holds', reason: ''},
    ],
    unrewritten: [],
    left: [{file: STARTED, hash: 'a1'}],
    everydayTests: 'passed',
    ...change,
  }
}

function checkout(change: Partial<Checkout> = {}): Checkout {
  return {
    pr: 7,
    prHeadReached: true,
    pins: [
      ['codex', '0.163.0'],
      ['claude', '2.1.322'],
    ],
    builds: {claudeProgram: '/vendor/claude', codexFolder: '/vendor/codex'},
    changedSince: [],
    dirty: [{file: STARTED, hash: 'a1'}],
    ...change,
  }
}

describe('resuming a provider-checks run', () => {
  it('builds on the saved run when HEAD and the tree are as it left them', () => {
    expect(whyNotResumable(saved(), checkout())).toBeNull()
  })

  it('refuses with no saved run, as on the first run, or one that posted nothing', () => {
    expect(whyNotResumable(null, checkout())).toBe(
      'No run in this checkout has been saved to resume.'
    )
    expect(
      whyNotResumable(saved({pr: null, head: null}), checkout({pr: null}))
    ).toBe('The saved run posted no result, so it is tied to no commit.')
  })

  it('refuses for another PR, or none', () => {
    expect(whyNotResumable(saved(), checkout({pr: 8}))).toBe(
      'The saved run was for #7, not #8.'
    )
    expect(whyNotResumable(saved(), checkout({pr: null}))).toBe(
      'The saved run was for #7, which no longer needs provider-checks.'
    )
  })

  it('refuses once the pins or the vendor builds differ', () => {
    expect(
      whyNotResumable(
        saved(),
        checkout({
          pins: [
            ['claude', '2.1.330'],
            ['codex', '0.163.0'],
          ],
        })
      )
    ).toBe('The pins have changed since the saved run.')
    expect(
      whyNotResumable(
        saved(),
        checkout({
          builds: {
            claudeProgram: '/other/claude',
            codexFolder: '/vendor/codex',
          },
        })
      )
    ).toBe('The vendor builds have changed since the saved run.')
  })

  it('takes commits since the saved run that change only the list of entries, and refuses any that change more', () => {
    expect(
      whyNotResumable(
        saved(),
        checkout({changedSince: ['docs/provider-dependencies.md']})
      )
    ).toBeNull()
    expect(
      whyNotResumable(
        saved(),
        checkout({
          changedSince: [
            'docs/provider-dependencies.md',
            `${CLAUDE}/replay.ts`,
          ],
        })
      )
    ).toBe(
      `HEAD has moved from the saved run's ${HEAD}, changing more than docs/provider-dependencies.md: \`${CLAUDE}/replay.ts\`.`
    )
    expect(whyNotResumable(saved(), checkout({changedSince: null}))).toBe(
      `The saved run's commit ${HEAD} isn't in this checkout's history.`
    )
  })

  it('refuses when the PR has commits this checkout lacks', () => {
    expect(whyNotResumable(saved(), checkout({prHeadReached: false}))).toBe(
      "#7's head isn't HEAD or behind it, so the PR has commits this checkout lacks."
    )
  })

  it('refuses when a recording the saved run left uncommitted is gone, reverted or changed', () => {
    const gone = `The saved run's new recordings \`${STARTED}\` are gone or changed since, so it can't vouch for them.`

    expect(whyNotResumable(saved(), checkout({dirty: []}))).toBe(gone)
    expect(
      whyNotResumable(saved(), checkout({dirty: [{file: STARTED, hash: 'b2'}]}))
    ).toBe(gone)
    expect(
      whyNotResumable(saved(), checkout({dirty: [{file: STARTED, hash: null}]}))
    ).toBe(gone)
  })

  it('refuses when anything but the saved run’s own recordings changed in the tree', () => {
    expect(
      whyNotResumable(
        saved(),
        checkout({
          dirty: [
            {file: STARTED, hash: 'a1'},
            {file: 'docs/provider-dependencies.md', hash: 'c3'},
          ],
        })
      )
    ).toBe(
      '`docs/provider-dependencies.md` changed since the saved run: commit or discard it.'
    )
  })
})

function everyday(run: SavedRun, head = HEAD) {
  return rerunOf(run, {list: LIST, head}).everydayTests
}

describe('what a provider-checks run runs', () => {
  it('runs everything with no saved run to build on', () => {
    expect(rerunOf(null, {list: LIST, head: HEAD})).toEqual({
      liveTests: EVERY_LIVE_TEST,
      reviews: ['stream-order', 'cut-short', 'self-updates-off'],
      everydayTests: true,
    })
  })

  it('runs nothing again after a run where everything passed', () => {
    expect(rerunOf(saved(), {list: LIST, head: HEAD})).toEqual({
      liveTests: null,
      reviews: [],
      everydayTests: false,
    })
  })

  it('runs again by its tag each live check that didn’t pass, and by its name each recording test with no tag to find it by', () => {
    const live = {
      failed: true,
      tests: [
        test('[records] [dep:stream-order] streams a Reply', 'failed'),
        test('[dep:cut-short] stops a Reply', 'skipped'),
        test('[records] compacts on its own (auto)', 'failed'),
        test('[records] writes a file', 'passed'),
      ],
    }

    const {liveTests} = rerunOf(saved({live}), {list: LIST, head: HEAD})

    expect(liveTests).toBe(
      String.raw`\[dep:stream-order\]|\[dep:cut-short\]|\[records\] compacts on its own \(auto\)`
    )

    const pattern = new RegExp(liveTests ?? '')

    expect(
      [
        'claude driver [records] [dep:stream-order] streams a Reply',
        'claude driver [dep:cut-short] stops a Reply',
        'claude driver [records] compacts on its own (auto)',
        'claude driver [records] writes a file',
      ].filter(name => pattern.test(name))
    ).toHaveLength(3)
  })

  it('runs a live check again that no test reported', () => {
    expect(
      rerunOf(
        saved({live: {tests: PASSING_TESTS.slice(0, 1), failed: false}}),
        {list: LIST, head: HEAD}
      ).liveTests
    ).toBe(String.raw`\[dep:cut-short\]`)
  })

  it('runs every live test again when the saved live side failed with no test to blame', () => {
    expect(
      rerunOf(saved({live: {tests: PASSING_TESTS, failed: true}}), {
        list: LIST,
        head: HEAD,
      }).liveTests
    ).toBe(EVERY_LIVE_TEST)
  })

  it('reviews again each entry not reviewed or stale, and each entry new or changed since', () => {
    const reviews: SavedRun['reviews'] = [
      {id: 'stream-order', verdict: 'stale', reason: 'gone'},
      {id: 'cut-short', verdict: 'holds', reason: ''},
      {id: 'self-updates-off', verdict: 'not reviewed', reason: 'no answer'},
    ]

    expect(rerunOf(saved({reviews}), {list: LIST, head: HEAD}).reviews).toEqual(
      ['stream-order', 'self-updates-off']
    )

    const edited = listOf([
      entry('stream-order'),
      entry('cut-short', '`[dep:cut-short]` in the codex driver'),
      entry('self-updates-off', 'none: a setting'),
      entry('new-one'),
    ])

    expect(rerunOf(saved(), {list: edited, head: 'd0c5'}).reviews).toEqual([
      'cut-short',
      'new-one',
    ])
  })

  it('reviews every entry again once the top of the list, which says what each field means, changed', () => {
    expect(
      rerunOf(saved(), {
        list: LIST.replace('# Provider dependencies', '# Provider deps'),
        head: 'd0c5',
      }).reviews
    ).toEqual(['stream-order', 'cut-short', 'self-updates-off'])
  })

  it('runs the everyday tests again when they didn’t pass, after a live test runs again, or on a new head', () => {
    expect(everyday(saved({everydayTests: 'failed'}))).toBe(true)
    expect(everyday(saved({live: {tests: PASSING_TESTS, failed: true}}))).toBe(
      true
    )
    expect(everyday(saved(), 'd0c5')).toBe(true)
    expect(everyday(saved())).toBe(false)
  })
})

describe('the outcomes a resumed run posts', () => {
  it('takes each live test the rerun ran, and keeps the saved outcome of one it skipped', () => {
    const before = {
      failed: true,
      tests: [
        test('[records] [dep:stream-order] streams a Reply', 'failed'),
        test('[dep:cut-short] stops a Reply', 'failed'),
        test('[records] compacts on its own', 'passed'),
      ],
    }

    const rerun = {
      failed: false,
      tests: [
        test('[records] [dep:stream-order] streams a Reply', 'passed'),
        test('[dep:cut-short] stops a Reply', 'skipped'),
        test('[records] compacts on its own', 'skipped'),
      ],
    }

    const live = mergedLive(before, rerun)

    expect(live.failed).toBe(true)
    expect(checksOf(entriesOf(LIST), live)).toEqual([
      {id: 'stream-order', status: 'passed'},
      {id: 'cut-short', status: 'failed'},
    ])
  })

  it('passes the live side once every test that failed passes', () => {
    const before = {
      failed: true,
      tests: [
        test('[records] [dep:stream-order] streams a Reply', 'failed'),
        ...PASSING_TESTS.slice(1),
      ],
    }

    const rerun = {
      failed: false,
      tests: [test('[records] [dep:stream-order] streams a Reply', 'passed')],
    }

    expect(mergedLive(before, rerun).failed).toBe(false)
    expect(
      mergedLive(before, {...rerun, failed: true}).failed,
      'the rerun itself failed'
    ).toBe(true)
  })

  it('carries a saved review, takes a fresh one, and drops one whose entry is gone', () => {
    const entries = entriesOf(
      listOf([entry('stream-order'), entry('cut-short')])
    )

    expect(
      mergedReviews(entries, saved().reviews, [
        {id: 'cut-short', verdict: 'stale', reason: 'gone'},
      ])
    ).toEqual([
      {id: 'stream-order', verdict: 'holds', reason: ''},
      {id: 'cut-short', verdict: 'stale', reason: 'gone'},
    ])
  })

  it('counts a recording as rewritten only once a run wrote it since that run started', () => {
    const resumedAt = 5000

    const recordings = [
      {file: STARTED, modified: 2000},
      {file: STOPPED, modified: 3000},
      {file: `${CLAUDE}/recordings/fresh.ndjson`, modified: 6000},
    ]

    expect(unrewrittenSince(null, recordings, 2500)).toEqual([STARTED])

    expect(
      unrewrittenSince(saved({unrewritten: [STOPPED]}), recordings, resumedAt),
      'the saved run missed it, and a checkout since touched it'
    ).toEqual([STOPPED])

    expect(
      unrewrittenSince(saved({startedAt: 2500}), recordings, resumedAt)
    ).toEqual([STARTED])
  })

  it('reads back a run it saved, and no run saved in another format', () => {
    const run = saved()

    expect(savedRunOf(JSON.stringify(run))).toEqual(run)
    expect(savedRunOf(JSON.stringify({...run, version: 0}))).toBeNull()
    expect(savedRunOf('{"version": 1')).toBeNull()
  })
})
