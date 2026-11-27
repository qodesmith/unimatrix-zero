import type {CheckStatus, Review} from './provider-checks-result.ts'
import type {Entry} from './provider-dependencies.ts'

import {z} from 'zod'

import {CheckStatusSchema, ReviewSchema} from './provider-checks-result.ts'
import {LIST, entriesOf, liveCheckOf, tagsIn} from './provider-dependencies.ts'
import {unrewritten} from './recordings.ts'

/** Vitest's `-t` for every live check and every test that writes a recording. */
export const EVERY_LIVE_TEST = String.raw`\[dep:|\[records\]`

const LiveTestSchema = z.object({
  file: z.string(),
  title: z.string(),
  status: z.string(),
})

const LiveRunSchema = z.object({
  tests: z.array(LiveTestSchema),
  failed: z.boolean(),
})

const FileStateSchema = z.object({
  file: z.string(),
  /** Git's blob hash of the file, or null for a deleted one. */
  hash: z.string().nullable(),
})

const SavedRunSchema = z.object({
  version: z.literal(1),
  /** Both null when the run posted nothing. */
  pr: z.number().nullable(),
  head: z.string().nullable(),
  startedAt: z.number(),
  pins: z.array(z.tuple([z.string(), z.string()])),
  builds: z.object({claudeProgram: z.string(), codexFolder: z.string()}),
  /** The text of `LIST` the reviews read. */
  list: z.string(),
  live: LiveRunSchema,
  reviews: z.array(ReviewSchema),
  unrewritten: z.array(z.string()),
  /** The recordings the run left uncommitted. */
  left: z.array(FileStateSchema),
  everydayTests: CheckStatusSchema,
})

export type LiveTest = z.infer<typeof LiveTestSchema>

export type LiveRun = z.infer<typeof LiveRunSchema>

export type FileState = z.infer<typeof FileStateSchema>

export type SavedRun = z.infer<typeof SavedRunSchema>

export interface Checkout {
  pr: number | null
  /** Whether the PR's head is HEAD or behind it, so a push fast-forwards. */
  prHeadReached: boolean
  pins: [string, string][]
  builds: SavedRun['builds']
  /**
   * The files that differ between the saved run's head and HEAD, or null when
   * it isn't in this checkout.
   */
  changedSince: string[] | null
  /** Each file that differs from HEAD, untracked ones too. */
  dirty: FileState[]
}

export interface Rerun {
  /** Vitest's `-t` for the live tests to run again, or null for none. */
  liveTests: string | null
  reviews: string[]
  everydayTests: boolean
}

export function savedRunOf(text: string) {
  try {
    return SavedRunSchema.parse(JSON.parse(text))
  } catch {
    return null
  }
}

export function isTagged(title: string) {
  return tagsIn(title).length > 0 || title.includes('[records]')
}

export function liveIdsOf(entries: Entry[]) {
  return entries.flatMap(entry =>
    liveCheckOf(entry) === entry.id ? [entry.id] : []
  )
}

function statusOf(outcomes: string[]): CheckStatus {
  if (outcomes.includes('failed')) return 'failed'

  return outcomes.length > 0 && outcomes.every(outcome => outcome === 'passed')
    ? 'passed'
    : 'not run'
}

function statusFor(id: string, tests: LiveTest[]) {
  return statusOf(
    tests.flatMap(test =>
      tagsIn(test.title).includes(id) ? [test.status] : []
    )
  )
}

export function checksOf(entries: Entry[], live: LiveRun) {
  return liveIdsOf(entries).map(id => ({id, status: statusFor(id, live.tests)}))
}

function listed(files: string[]) {
  return files.map(file => `\`${file}\``).join(', ')
}

function treeProblem(saved: SavedRun, checkout: Checkout) {
  const kept = saved.left.map(state => state.file)

  const gone = saved.left.flatMap(state =>
    checkout.dirty.some(
      now => now.file === state.file && now.hash === state.hash
    )
      ? []
      : [state.file]
  )

  if (gone.length > 0) {
    return `The saved run's new recordings ${listed(gone)} are gone or changed since, so it can't vouch for them.`
  }

  const changed = checkout.dirty.flatMap(state =>
    kept.includes(state.file) ? [] : [state.file]
  )

  return changed.length > 0
    ? `${listed(changed)} changed since the saved run: commit or discard it.`
    : null
}

function headProblem(saved: SavedRun, checkout: Checkout) {
  if (checkout.changedSince === null) {
    return `The saved run's commit ${saved.head} isn't in this checkout's history.`
  }

  const beyond = checkout.changedSince.filter(file => file !== LIST)

  if (beyond.length > 0) {
    return `HEAD has moved from the saved run's ${saved.head}, changing more than ${LIST}: ${listed(beyond)}.`
  }

  return checkout.prHeadReached
    ? null
    : `#${checkout.pr}'s head isn't HEAD or behind it, so the PR has commits this checkout lacks.`
}

function pinsText(pins: [string, string][]) {
  return JSON.stringify(pins.map(pin => pin.join(' ')).toSorted())
}

function setupProblem(saved: SavedRun, checkout: Checkout) {
  if (checkout.pr !== saved.pr) {
    return checkout.pr === null
      ? `The saved run was for #${saved.pr}, which no longer needs provider-checks.`
      : `The saved run was for #${saved.pr}, not #${checkout.pr}.`
  }

  if (pinsText(saved.pins) !== pinsText(checkout.pins)) {
    return 'The pins have changed since the saved run.'
  }

  const {claudeProgram, codexFolder} = checkout.builds

  return saved.builds.claudeProgram === claudeProgram &&
    saved.builds.codexFolder === codexFolder
    ? null
    : 'The vendor builds have changed since the saved run.'
}

/**
 * Why `--resume` can't build on `saved` here, or null when it can: the result
 * it posts must hold for the head it names, so only the saved run's own
 * uncommitted recordings and commits that touch nothing but `LIST` may lie
 * between them.
 */
export function whyNotResumable(saved: SavedRun | null, checkout: Checkout) {
  if (!saved) return 'No run in this checkout has been saved to resume.'

  if (saved.pr === null || saved.head === null) {
    return 'The saved run posted no result, so it is tied to no commit.'
  }

  return (
    setupProblem(saved, checkout) ??
    headProblem(saved, checkout) ??
    treeProblem(saved, checkout)
  )
}

function escapedForRegExp(text: string) {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

function liveTestsToRerun(live: LiveRun, entries: Entry[]) {
  const ids = liveIdsOf(entries).filter(
    id => statusFor(id, live.tests) !== 'passed'
  )

  const titles = live.tests.flatMap(test =>
    test.status === 'passed' || tagsIn(test.title).some(id => ids.includes(id))
      ? []
      : [test.title]
  )

  if (ids.length === 0 && titles.length === 0) {
    return live.failed ? EVERY_LIVE_TEST : null
  }

  return [
    ...ids.map(id => escapedForRegExp(`[dep:${id}]`)),
    ...new Set(titles.map(escapedForRegExp)),
  ].join('|')
}

function preambleOf(list: string) {
  return list.split(/^## Entries$/m)[0] ?? ''
}

function reviewsToRerun(saved: SavedRun, entries: Entry[], list: string) {
  const before = entriesOf(saved.list)
  const sameTop = preambleOf(saved.list) === preambleOf(list)

  return entries.flatMap(entry => {
    const earlier = before.find(old => old.id === entry.id)

    const holds = saved.reviews.some(
      review => review.id === entry.id && review.verdict === 'holds'
    )

    return sameTop && holds && JSON.stringify(earlier) === JSON.stringify(entry)
      ? []
      : [entry.id]
  })
}

/**
 * What a run does again on top of `saved`, or all of it with none: the live
 * tests that didn't pass, the reviews that don't hold or whose entry changed,
 * and the everyday tests unless they passed against the same tree.
 */
export function rerunOf(
  saved: SavedRun | null,
  current: {list: string; head: string}
): Rerun {
  const entries = entriesOf(current.list)

  if (!saved) {
    return {
      liveTests: EVERY_LIVE_TEST,
      reviews: entries.map(entry => entry.id),
      everydayTests: true,
    }
  }

  const liveTests = liveTestsToRerun(saved.live, entries)

  return {
    liveTests,
    reviews: reviewsToRerun(saved, entries, current.list),
    everydayTests:
      saved.everydayTests !== 'passed' ||
      liveTests !== null ||
      saved.head !== current.head,
  }
}

function keyOf(test: LiveTest) {
  return `${test.file}\0${test.title}`
}

/** A test the rerun didn't reach keeps its saved outcome. */
export function mergedLive(saved: LiveRun | null, ran: LiveRun | null) {
  if (!saved || !ran) return ran ?? saved ?? {tests: [], failed: false}

  const fresh = new Map(
    ran.tests.flatMap(test =>
      test.status === 'passed' || test.status === 'failed'
        ? [[keyOf(test), test] as const]
        : []
    )
  )

  const known = new Set(saved.tests.map(keyOf))

  const tests = [
    ...saved.tests.map(test => fresh.get(keyOf(test)) ?? test),
    ...ran.tests.filter(test => !known.has(keyOf(test))),
  ]

  return {
    tests,
    failed: ran.failed || tests.some(test => test.status === 'failed'),
  }
}

export function mergedReviews(
  entries: Entry[],
  saved: Review[],
  ran: Review[]
): Review[] {
  return entries.map(
    entry =>
      ran.find(review => review.id === entry.id) ??
      saved.find(review => review.id === entry.id) ?? {
        id: entry.id,
        verdict: 'not reviewed',
        reason: 'reviewed in neither this run nor the saved one',
      }
  )
}

/**
 * The recordings last written before this run started at `since` that, when
 * it resumes `saved`, the saved run didn't rewrite either.
 */
export function unrewrittenSince(
  saved: SavedRun | null,
  recordings: {file: string; modified: number}[],
  since: number
) {
  const missed = unrewritten(recordings, since)

  if (!saved) return missed

  const before = new Set(unrewritten(recordings, saved.startedAt))

  return missed.filter(
    file => before.has(file) || saved.unrewritten.includes(file)
  )
}
