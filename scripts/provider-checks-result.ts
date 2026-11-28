import {z} from 'zod'

export type CheckStatus = 'passed' | 'failed' | 'not run'

const VERDICTS = ['holds', 'stale', 'not reviewed', 'not needed'] as const

export interface Review {
  id: string
  /**
   * `not reviewed` is a review that ran and gave no verdict. `not needed` is
   * an entry left out on purpose, which passes only when no pin moved.
   */
  verdict: (typeof VERDICTS)[number]
  reason: string
}

export interface Result {
  /** Null when there was no PR to post on. */
  head: string | null
  pinChanges: string[]
  /** The live tests, recorders and recordings the PR changes. */
  gatedFiles: string[]
  checks: {id: string; status: CheckStatus}[]
  /** The live tests that passed only on their retry. */
  retried: string[]
  reviews: Review[]
  whyKept: string | null
  everydayTests: CheckStatus
}

const MARKER = /<!-- provider-checks (\{.*?\}) -->/

const Marker = z.object({head: z.string(), passed: z.boolean()})

export function passed(result: Result) {
  return (
    result.checks.every(check => check.status === 'passed') &&
    result.reviews.every(
      review =>
        review.verdict === 'holds' ||
        (review.verdict === 'not needed' && result.pinChanges.length === 0)
    ) &&
    result.whyKept === null &&
    result.everydayTests === 'passed'
  )
}

function counts(values: string[]) {
  const tally = new Map<string, number>()

  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)

  return [...tally].map(([value, count]) => `${count} ${value}`).join(', ')
}

function reviewLine(reviews: Review[]) {
  const tally = VERDICTS.flatMap(verdict => {
    const count = reviews.filter(review => review.verdict === verdict).length

    return count > 0 ? [`${count} ${verdict}`] : []
  }).join(', ')

  const why = reviews.find(review => review.verdict === 'not needed')?.reason

  return `${tally || 'none'}${why ? `: ${why}` : ''}`
}

function escaped(text: string) {
  return text.replaceAll('|', String.raw`\|`).replaceAll('\n', ' ')
}

export function renderResult(result: Result) {
  const marker = result.head
    ? [
        `<!-- provider-checks ${JSON.stringify({head: result.head, passed: passed(result)})} -->`,
      ]
    : []

  const unsettled = result.reviews.filter(
    review => review.verdict === 'stale' || review.verdict === 'not reviewed'
  )

  return [
    `## Provider checks: ${passed(result) ? 'passed' : 'failed'}`,
    '',
    ...(result.head ? [`For ${result.head}.`] : []),
    ...(result.pinChanges.length > 0
      ? [`Pins: ${result.pinChanges.join(', ')}.`]
      : []),
    ...(result.gatedFiles.length > 0
      ? [
          `Live tests, recorders or recordings changed: ${result.gatedFiles.length}.`,
        ]
      : []),
    '',
    `**Recordings:** ${result.whyKept === null ? 're-recorded' : `kept the old ones, since ${result.whyKept}`}`,
    '',
    `**Everyday tests:** ${result.everydayTests}`,
    '',
    `**Live checks:** ${counts(result.checks.map(check => check.status)) || 'none'}`,
    '',
    '| Entry | Live check |',
    '| --- | --- |',
    ...result.checks.map(check => `| \`${check.id}\` | ${check.status} |`),
    ...(result.retried.length > 0
      ? [
          '',
          `**Passed on a retry:** ${result.retried.length}`,
          '',
          ...result.retried.map(title => `- ${title.replaceAll('<', '&lt;')}`),
        ]
      : []),
    '',
    `**Review:** ${reviewLine(result.reviews)}`,
    ...(unsettled.length > 0
      ? [
          '',
          '| Entry | Review | Why |',
          '| --- | --- | --- |',
          ...unsettled.map(
            review =>
              `| \`${review.id}\` | ${review.verdict} | ${escaped(review.reason)} |`
          ),
        ]
      : []),
    ...(marker.length > 0 ? ['', ...marker] : []),
    '',
  ].join('\n')
}

function markerOf(body: string) {
  const json = MARKER.exec(body)?.[1]

  if (json === undefined) return null

  try {
    return Marker.parse(JSON.parse(json))
  } catch {
    return null
  }
}

export interface Comment {
  login: string
  body: string
}

/** A file changed since a result's commit, and why it needs a new run. */
export interface Cause {
  file: string
  why: string
}

/** What changed between a result's commit and the PR's head. */
export type Since = {ancestor: false} | {ancestor: true; causes: Cause[]}

function earlierResultVerdict(
  owner: string,
  head: string,
  from: string,
  since: Since
) {
  const rerun = `Check out ${head} and run \`bun run provider-checks\`.`

  if (!since.ancestor) {
    return {
      pass: false,
      reason: `${owner}'s provider-checks passed on ${from}, which is no longer in this PR's history. ${rerun}`,
    }
  }

  if (since.causes.length > 0) {
    return {
      pass: false,
      reason: [
        `${owner}'s provider-checks passed on ${from}, but these changes since need a new run:`,
        ...since.causes.map(({file, why}) => `  ${file}: ${why}`),
        rerun,
      ].join('\n'),
    }
  }

  return {
    pass: true,
    reason: `${owner}'s provider-checks passed on ${from}, and nothing since needs a new run, so that result carries over to ${head}.`,
  }
}

/**
 * A PR the gate holds passes on its owner's newest result for its head commit,
 * so anyone else's comment doesn't count. With none, the owner's newest
 * passing result carries over when nothing changed since needs a new run.
 */
export async function gateVerdict(input: {
  owner: string
  head: string
  comments: Comment[]
  changesSince: (commit: string) => Promise<Since>
}) {
  const {owner, head, comments, changesSince} = input

  const results = comments
    .filter(comment => comment.login === owner)
    .flatMap(comment => {
      const marker = markerOf(comment.body)

      return marker ? [marker] : []
    })

  const latest =
    results.findLast(result => result.head === head) ?? results.at(-1)

  if (!latest) {
    return {
      pass: false,
      reason: `No provider-checks result from ${owner} for ${head}. Check out this commit and run \`bun run provider-checks\`.`,
    }
  }

  if (!latest.passed) {
    return {
      pass: false,
      reason: `${owner}'s provider-checks on ${latest.head} found a failing check, a stale entry, a recording it kept or a failing everyday test.`,
    }
  }

  return latest.head === head
    ? {pass: true, reason: `${owner}'s provider-checks passed on ${head}.`}
    : earlierResultVerdict(
        owner,
        head,
        latest.head,
        await changesSince(latest.head)
      )
}
