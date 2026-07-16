/**
 * The oxlint drift policy, isolated from CI plumbing: three version strings
 * in, a verdict out. `check-oxlint-drift.ts` is the CI adapter that gathers
 * the versions and writes the outputs.
 */

// If the latest published oxlint is this many minor versions (or more) ahead of
// what we have installed, we're falling behind the ecosystem and CI should fail.
const MINOR_DRIFT_THRESHOLD = 5

export interface DriftVersions {
  /** Oxlint version installed per the lockfile. */
  installed: string

  /** Latest oxlint version published to npm. */
  latest: string

  /**
   * Version whose rule changes were last reviewed
   * (reviewed-oxlint-version.json).
   */
  reviewed: string
}

export interface DriftVerdict {
  shouldFail: boolean

  /** One markdown fragment per failed requirement; empty when in sync. */
  reasons: string[]
}

function parseVersion(version: string) {
  const [major, minor] = version.split('.').map(Number)
  return {major, minor}
}

export function evaluateDrift({
  installed,
  latest,
  reviewed,
}: DriftVersions): DriftVerdict {
  const installedV = parseVersion(installed)
  const latestV = parseVersion(latest)

  const reasons: string[] = []

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

  return {shouldFail: reasons.length > 0, reasons}
}

/**
 * PR-comment body for a failing verdict. Ends with the rule-changes heading —
 * the workflow concatenates the generated delta directly after it. Returns an
 * empty string when there are no reasons.
 */
export function formatDriftMarkdown(reasons: string[]): string {
  if (reasons.length === 0) return ''

  return [
    '## oxlint rule drift detected',
    '',
    ...reasons.map(reason => `- ${reason}`),
    '',
    '---',
    '',
    '### Rule changes since the last reviewed version',
    '',
  ].join('\n')
}
