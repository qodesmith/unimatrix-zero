import {z} from 'zod'

export const CheckStatusSchema = z.enum(['passed', 'failed', 'not run'])

export type CheckStatus = z.infer<typeof CheckStatusSchema>

export const ReviewSchema = z.object({
  id: z.string(),
  verdict: z.enum(['holds', 'stale', 'not reviewed']),
  reason: z.string(),
})

export type Review = z.infer<typeof ReviewSchema>

/** What a resumed run ran again, on top of the saved run for `from`. */
interface Resumed {
  from: string
  liveTests: number
  reviews: number
  everydayTests: boolean
}

export interface Result {
  /** Null when there was no PR to post on. */
  head: string | null
  pinChanges: string[]
  /** The live tests, recorders and recordings the PR changes. */
  gatedFiles: string[]
  checks: {id: string; status: CheckStatus}[]
  reviews: Review[]
  whyKept: string | null
  everydayTests: CheckStatus
  resumed: Resumed | null
}

const MARKER = /<!-- provider-checks (\{.*?\}) -->/

const Marker = z.object({head: z.string(), passed: z.boolean()})

export function passed(result: Result) {
  return (
    result.checks.every(check => check.status === 'passed') &&
    result.reviews.every(review => review.verdict === 'holds') &&
    result.whyKept === null &&
    result.everydayTests === 'passed'
  )
}

function counts(values: string[]) {
  const tally = new Map<string, number>()

  for (const value of values) tally.set(value, (tally.get(value) ?? 0) + 1)

  return [...tally].map(([value, count]) => `${count} ${value}`).join(', ')
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function resumedLine(resumed: Resumed) {
  const reran = [
    ...(resumed.liveTests > 0 ? [plural(resumed.liveTests, 'live test')] : []),
    ...(resumed.reviews > 0 ? [plural(resumed.reviews, 'review')] : []),
    ...(resumed.everydayTests ? ['the everyday tests'] : []),
  ]

  const listed =
    reran.length > 1
      ? `${reran.slice(0, -1).join(', ')} and ${reran.at(-1)}`
      : (reran[0] ?? 'nothing')

  return `Resumed the run for ${resumed.from}, running ${listed} again.`
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
    ...(result.resumed ? [resumedLine(result.resumed)] : []),
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
