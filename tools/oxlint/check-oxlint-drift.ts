// oxlint-disable no-console
import {$} from 'bun'

// bun.lock is JSONC (trailing commas), so this relies on Bun's jsonc import
// support — run this script with `bun`, not `node`.
import lock from '../../bun.lock' with {type: 'jsonc'}
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

// If the latest published oxlint is this many minor versions (or more) ahead of
// what we have installed, we're falling behind the ecosystem and CI should fail.
const MINOR_DRIFT_THRESHOLD = 5

function parseVersion(version: string) {
  const [major, minor, patch] = version.split('.').map(Number)
  return {major, minor, patch}
}

// Lockfile entries look like `"oxlint": ["oxlint@1.74.0", ...]`.
const installed = lock.packages.oxlint?.[0]?.replace(/^oxlint@/, '')
if (!installed) {
  throw new Error("Could not read packages.oxlint's version from bun.lock")
}

const reviewed = reviewedOxlintVersion.version

const latest = (await $`bun info oxlint version`.text()).trim()

const installedV = parseVersion(installed)
const latestV = parseVersion(latest)

const reasons = []

// Req 1: too far behind the latest published release.
if (latestV.major > installedV.major) {
  reasons.push(
    `**oxlint is a major version behind.** Installed \`${installed}\`, latest published \`${latest}\`.`
  )
} else if (
  latestV.major === installedV.major &&
  latestV.minor - installedV.minor >= MINOR_DRIFT_THRESHOLD
) {
  reasons.push(
    `**oxlint is ${latestV.minor - installedV.minor} minor versions behind** (threshold is ${MINOR_DRIFT_THRESHOLD}). Installed \`${installed}\`, latest published \`${latest}\`.`
  )
}

// Req 2 (invariant): the installed version must always match the version we've
// reviewed rule changes for. A bump to either without the other trips this.
if (installed !== reviewed) {
  reasons.push(
    `**Installed oxlint (\`${installed}\`) does not match the reviewed version (\`${reviewed}\`).** Review the rule changes below, then set \`tools/oxlint/reviewed-oxlint-version.json\` to \`${installed}\`.`
  )
}

const shouldFail = reasons.length > 0

const body = shouldFail
  ? [
      '## oxlint rule drift detected',
      '',
      ...reasons.map(reason => `- ${reason}`),
      '',
      '---',
      '',
      '### Rule changes since the last reviewed version',
      '',
    ].join('\n')
  : ''

// Written to RUNNER_TEMP (per-job, isolated, auto-cleaned) so nothing lands in
// the working tree. The workflow reads this same path and concatenates it onto
// the generated rule-change delta. Guaranteed set by the CI guard above.
await Bun.write(`${process.env.RUNNER_TEMP}/oxlint-drift-reason.md`, body)

console.log(body || 'oxlint is in sync — no drift detected.')

if (process.env.GITHUB_OUTPUT) {
  // Must append (>>) — the runner shares this file across all of a job's steps.
  const output = `should_fail=${shouldFail}`
  await $`echo ${output} >> ${process.env.GITHUB_OUTPUT}`
}
