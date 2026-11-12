/**
 * The result of `bun run provider-checks`: the comment it posts on a bump PR,
 * and the CI gate's reading of those comments.
 */
import {z} from 'zod'

export type CheckStatus = 'passed' | 'failed' | 'not run'

export interface Review {
  id: string
  verdict: 'holds' | 'stale' | 'not reviewed'
  reason: string
}

export interface Result {
  /** The commit the run checked, or null when there was no PR to post on. */
  head: string | null
  pinChanges: string[]
  checks: {id: string; status: CheckStatus}[]
  reviews: Review[]
}

const MARKER = /<!-- provider-checks (\{.*?\}) -->/

const Marker = z.object({head: z.string(), passed: z.boolean()})

export function passed(result: Result) {
  return (
    result.checks.every(check => check.status === 'passed') &&
    result.reviews.every(review => review.verdict === 'holds')
  )
}

function counts(values: string[]) {
  const tally = new Map<string, number>()

  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)

  return [...tally].map(([value, count]) => `${count} ${value}`).join(', ')
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

  const unsettled = result.reviews.filter(review => review.verdict !== 'holds')

  return [
    `## Provider checks: ${passed(result) ? 'passed' : 'failed'}`,
    '',
    ...(result.head ? [`For ${result.head}.`] : []),
    ...(result.pinChanges.length > 0
      ? [`Pins: ${result.pinChanges.join(', ')}.`]
      : []),
    '',
    `**Live checks:** ${counts(result.checks.map(check => check.status)) || 'none'}`,
    '',
    '| Entry | Live check |',
    '| --- | --- |',
    ...result.checks.map(check => `| \`${check.id}\` | ${check.status} |`),
    '',
    `**Review:** ${counts(result.reviews.map(review => review.verdict)) || 'none'}`,
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
 * A bump PR passes on the newest result its owner posted for its head commit,
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
        reason: `${owner}'s provider-checks on ${head} found a failing check or a stale entry.`,
      }
}
