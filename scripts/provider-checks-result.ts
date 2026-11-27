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

/**
 * A PR the gate holds passes on its owner's newest result for its head commit,
 * so a push after the run, or anyone else's comment, doesn't count.
 */
export function gateVerdict(input: {
  owner: string
  head: string
  comments: Comment[]
}) {
  const {owner, head, comments} = input

  const latest = comments
    .filter(comment => comment.login === owner)
    .flatMap(comment => {
      const marker = markerOf(comment.body)

      return marker?.head === head ? [marker] : []
    })
    .at(-1)

  if (!latest) {
    return {
      pass: false,
      reason: `No provider-checks result from ${owner} for ${head}. Check out this commit and run \`bun run provider-checks\`.`,
    }
  }

  return latest.passed
    ? {pass: true, reason: `${owner}'s provider-checks passed on ${head}.`}
    : {
        pass: false,
        reason: `${owner}'s provider-checks on ${head} found a failing check, a stale entry, a recording it kept or a failing everyday test.`,
      }
}
