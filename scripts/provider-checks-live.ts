import type {CheckStatus} from './provider-checks-result.ts'

import {z} from 'zod'

import {tagsIn} from './provider-dependencies.ts'

/**
 * Vitest's arguments for the one run of every tagged live test. Retrying a
 * test that records is safe only while its recorder uses `claimRecordings`.
 */
export function liveTestArgs(report: string) {
  return [
    'run',
    '.live.test.ts',
    '--project',
    'node',
    '-t',
    String.raw`\[records\]|\[dep:`,
    '--retry',
    '1',
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${report}`,
  ]
}

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
    retried: tests.flatMap(test =>
      test.status === 'passed' && (test.failureMessages ?? []).length > 0
        ? [test.title]
        : []
    ),
  }
}
