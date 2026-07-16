// oxlint-disable no-console

/**
 * CI adapter for the drift policy in `drift.ts`: gathers the three versions
 * (lockfile, npm, reviewed), evaluates them, and writes the outputs the
 * oxlint-rule-drift workflow reads.
 */
import {$} from 'bun'

// bun.lock is JSONC (trailing commas), so this relies on Bun's jsonc import
// support — run this script with `bun`, not `node`.
import lock from '../../bun.lock' with {type: 'jsonc'}
import {evaluateDrift, formatDriftReport} from './drift'
import reviewedOxlintVersion from './reviewed-oxlint-version.json' with {type: 'json'}

// CI-only: this script writes to RUNNER_TEMP and is meant to run inside the
// oxlint-rule-drift GitHub Actions job. Bail anywhere else so it can't be run
// locally against an unexpected temp dir. GITHUB_ACTIONS and RUNNER_TEMP are
// both set by the runner on every job.
if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP) {
  throw new Error(
    'check-oxlint-drift.ts only runs in GitHub Actions (requires GITHUB_ACTIONS=true and RUNNER_TEMP).'
  )
}

// Lockfile entries look like `"oxlint": ["oxlint@1.74.0", ...]`.
const installed = lock.packages.oxlint?.[0]?.replace(/^oxlint@/, '')
if (!installed) {
  throw new Error("Could not read packages.oxlint's version from bun.lock")
}

const latest = (await $`bun info oxlint version`.text()).trim()

const {shouldFail, findings} = evaluateDrift({
  installed,
  latest,
  reviewed: reviewedOxlintVersion.version,
})

const report = formatDriftReport(findings)

// Written to RUNNER_TEMP (per-job, isolated, auto-cleaned) so nothing lands in
// the working tree. The workflow reads this same path and concatenates it onto
// the generated rule-change delta, so a non-empty body must end in a newline.
// RUNNER_TEMP is guaranteed set by the CI guard above.
await Bun.write(
  `${process.env.RUNNER_TEMP}/oxlint-drift-reason.md`,
  report.markdown && `${report.markdown}\n`
)

console.log(report.markdown || report.text)

if (process.env.GITHUB_OUTPUT) {
  // Must append (>>) — the runner shares this file across all of a job's steps.
  const output = `should_fail=${shouldFail}`
  await $`echo ${output} >> ${process.env.GITHUB_OUTPUT}`
}
