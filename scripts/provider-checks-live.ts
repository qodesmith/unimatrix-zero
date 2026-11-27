import type {CheckStatus} from './provider-checks-result.ts'

import {z} from 'zod'

import {tagsIn} from './provider-dependencies.ts'

/**
 * Between them the two runs take each tagged live test once. A test that
 * records gets no retry: a recorder writes its file when the vendor program
 * exits, so a failed first try could still write over the retry's recording.
 */
export const LIVE_RUNS = [
  {pattern: String.raw`\[records\]`, retry: 0},
  {pattern: String.raw`^(?!.*\[records\]).*\[dep:`, retry: 1},
]

export const VitestReport = z.looseObject({
  testResults: z.array(
    z.looseObject({
      assertionResults: z.array(
        z.looseObject({
          title: z.string(),
          status: z.string(),
          failureMessages: z.array(z.string()).optional(),
        })
      ),
    })
  ),
})

type LiveTest = z.infer<
  typeof VitestReport
>['testResults'][number]['assertionResults'][number]

function statusOf(outcomes: string[]): CheckStatus {
  if (outcomes.includes('failed')) return 'failed'

  return outcomes.length > 0 && outcomes.every(outcome => outcome === 'passed')
    ? 'passed'
    : 'not run'
}

export function liveOutcome(ids: string[], tests: LiveTest[]) {
  const outcomes = new Map<string, string[]>()

  for (const test of tests) {
    for (const id of tagsIn(test.title)) {
      outcomes.set(id, [...(outcomes.get(id) ?? []), test.status])
    }
  }

  return {
    checks: ids.map(id => ({id, status: statusOf(outcomes.get(id) ?? [])})),
    failed: tests.some(test => test.status === 'failed'),
    // Vitest's JSON report gives no retry count, but a passed test keeps the
    // failure messages of the tries before.
    retried: tests.flatMap(test =>
      test.status === 'passed' && (test.failureMessages ?? []).length > 0
        ? [test.title]
        : []
    ),
  }
}
