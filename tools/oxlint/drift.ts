/**
 * The oxlint drift policy, isolated from CI plumbing: three version strings
 * in, a verdict out. `check-oxlint-drift.ts` is the CI adapter that gathers
 * the versions and writes the outputs.
 */
import type {Finding, FindingsReport} from '../findings'

import {formatFindings} from '../findings'

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

  /** One finding per failed requirement; empty when in sync. */
  findings: Finding[]
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

  const findings: Finding[] = []

  // Req 1: too far behind the latest published release.
  if (latestV.major > installedV.major) {
    findings.push({
      file: 'package.json',
      from: installed,
      to: latest,
      reason: 'oxlint is a major version behind the latest published release',
    })
  } else if (
    latestV.major === installedV.major &&
    latestV.minor - installedV.minor >= MINOR_DRIFT_THRESHOLD
  ) {
    findings.push({
      file: 'package.json',
      from: installed,
      to: latest,
      reason:
        `oxlint is ${latestV.minor - installedV.minor} minor versions ` +
        `behind (threshold is ${MINOR_DRIFT_THRESHOLD})`,
    })
  }

  // Req 2 (invariant): the installed version must always match the version we've
  // reviewed rule changes for. A bump to either without the other trips this.
  if (installed !== reviewed) {
    findings.push({
      file: 'tools/oxlint/reviewed-oxlint-version.json',
      from: reviewed,
      to: installed,
      reason:
        'installed oxlint does not match the reviewed version — review ' +
        'the rule changes below, then set the reviewed version to ' +
        `${installed}`,
    })
  }

  return {shouldFail: findings.length > 0, findings}
}

/**
 * Renders the verdict through the shared findings module. The markdown
 * (the PR-comment body) ends with the rule-changes heading — the workflow
 * concatenates the generated delta directly after it — and is an empty
 * string when there are no findings.
 */
export function formatDriftReport(findings: Finding[]): FindingsReport {
  return formatFindings(
    {
      title: 'oxlint rule drift detected',
      intro: count => `${count} requirement(s) failed:`,
      emptyText: 'oxlint is in sync — no drift detected.',
      footer: '---\n\n### Rule changes since the last reviewed version',
    },
    findings
  )
}
