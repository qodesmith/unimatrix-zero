/**
 * `bun run provider-checks [--pr <n>]`, by hand on the maintainer's machine:
 * runs every `[dep:<id>]` live check, has an agent review each entry of the
 * list, and posts both on the open bump PR for CI's gate.
 */
import type {CheckStatus, Review} from './provider-checks-result.ts'
import type {Builds} from './provider-review.ts'

import {$} from 'bun'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {parseArgs} from 'node:util'
import {z} from 'zod'

import {passed, renderResult} from './provider-checks-result.ts'
import {LIST, entriesOf, liveCheckOf, tagsIn} from './provider-dependencies.ts'
import {review} from './provider-review.ts'
import {bumpOf, pinsOf} from './vendor-pins.ts'

const root = path.resolve(import.meta.dirname, '..')
const GATE_JOB = 'Provider checks on a vendor bump'
const REVIEWERS = 4

const LiveEnv = z.object({
  UZ_LIVE_CLAUDE_PROGRAM: z.string().min(1),
  UZ_LIVE_CLAUDE_CONFIG: z.string().min(1),
  UZ_LIVE_CODEX_PROGRAM: z.string().min(1),
  UZ_LIVE_CODEX_HOME: z.string().min(1),
})

const Pulls = z.array(
  z.looseObject({
    number: z.number(),
    base: z.looseObject({sha: z.string()}),
    head: z.looseObject({sha: z.string()}),
  })
)

const VitestReport = z.looseObject({
  testResults: z.array(
    z.looseObject({
      assertionResults: z.array(
        z.looseObject({title: z.string(), status: z.string()})
      ),
    })
  ),
})

const Runs = z.looseObject({
  workflow_runs: z.array(
    z.looseObject({id: z.number(), status: z.string().nullable()})
  ),
})

const Jobs = z.looseObject({
  jobs: z.array(z.looseObject({id: z.number(), name: z.string()})),
})

interface Bump {
  number: number
  head: string
  changes: string[]
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function api(call: string) {
  return $`gh api ${call}`.text()
}

function liveBuilds(): Builds {
  const env = LiveEnv.safeParse(process.env)

  if (!env.success) {
    fail(
      `Set ${Object.keys(LiveEnv.shape).join(', ')}, as the live tests' headers describe.`
    )
  }

  const pins = pinsOf(
    readText('app/main/src/modules/vendor-programs/dev-manifest.json'),
    readText('app/provider-host/package.json')
  )

  const claudeProgram = env.data.UZ_LIVE_CLAUDE_PROGRAM
  const codexFolder = env.data.UZ_LIVE_CODEX_PROGRAM

  if (!claudeProgram.split(path.sep).includes(pins.get('claude') ?? '')) {
    fail(
      `UZ_LIVE_CLAUDE_PROGRAM isn't the pinned claude ${pins.get('claude')}.`
    )
  }

  if (path.basename(codexFolder) !== pins.get('codex')) {
    fail(`UZ_LIVE_CODEX_PROGRAM isn't the pinned Codex ${pins.get('codex')}.`)
  }

  return {pins, claudeProgram, codexFolder}
}

function readText(file: string) {
  return fs.readFileSync(path.join(root, file), 'utf8')
}

async function findBump(repo: string, wanted: number | null) {
  const open = Pulls.parse(
    JSON.parse(await api(`repos/${repo}/pulls?state=open&per_page=100`))
  )

  const bumps: Bump[] = []

  for (const pull of open) {
    if (wanted !== null && pull.number !== wanted) continue

    const changes = await bumpOf(api, repo, {
      base: pull.base.sha,
      head: pull.head.sha,
    })

    if (changes.length > 0) {
      bumps.push({number: pull.number, head: pull.head.sha, changes})
    }
  }

  if (wanted !== null && bumps.length === 0) {
    fail(`#${wanted} isn't an open PR that moves a vendor pin.`)
  }

  if (bumps.length > 1) {
    fail(
      `${bumps.length} bump PRs are open (${bumps.map(bump => `#${bump.number}`).join(', ')}): pick one with --pr <n>.`
    )
  }

  return bumps[0] ?? null
}

async function checkedOut(bump: Bump) {
  const head = (await $`git rev-parse HEAD`.cwd(root).text()).trim()
  const dirty = (await $`git status --porcelain`.cwd(root).text()).trim()

  if (head !== bump.head || dirty) {
    fail(
      `The result is tied to #${bump.number}'s head ${bump.head}: run on a clean checkout of it (gh pr checkout ${bump.number}).`
    )
  }
}

async function runLiveChecks(ids: string[]) {
  const report = path.join(os.tmpdir(), `uz-provider-checks-${Date.now()}.json`)

  await Bun.spawn(
    [
      'bun',
      'run',
      'scripts/vitest.ts',
      'run',
      '--project',
      'node',
      '-t',
      String.raw`\[dep:`,
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${report}`,
    ],
    {cwd: root, stdio: ['inherit', 'inherit', 'inherit']}
  ).exited

  const outcomes = new Map<string, string[]>()

  const ran = await Bun.file(report)
    .json()
    .catch(() => ({testResults: []}))

  for (const file of VitestReport.parse(ran).testResults) {
    for (const test of file.assertionResults) {
      for (const id of tagsIn(test.title)) {
        outcomes.set(id, [...(outcomes.get(id) ?? []), test.status])
      }
    }
  }

  return ids.map(id => ({id, status: statusOf(outcomes.get(id) ?? [])}))
}

function statusOf(outcomes: string[]): CheckStatus {
  if (outcomes.includes('failed')) return 'failed'

  return outcomes.length > 0 && outcomes.every(outcome => outcome === 'passed')
    ? 'passed'
    : 'not run'
}

async function reviewAll(builds: Builds) {
  const entries = entriesOf(readText(LIST))
  const reviews: Review[] = []
  let next = 0

  async function reviewer() {
    for (let entry = entries[next++]; entry; entry = entries[next++]) {
      console.log(`Reviewing ${entry.id}…`)
      reviews.push(await review(entry, builds, root))
    }
  }

  await Promise.all(Array.from({length: REVIEWERS}, reviewer))

  return entries.flatMap(entry =>
    reviews.filter(reviewed => reviewed.id === entry.id)
  )
}

/** CI read the comments before this run posted; its gate job reads them again. */
async function rerunGate(repo: string, bump: Bump) {
  const {
    workflow_runs: [run],
  } = Runs.parse(
    JSON.parse(
      await api(
        `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${bump.head}&event=pull_request`
      )
    )
  )

  if (run?.status !== 'completed') {
    console.warn(
      `CI on ${bump.head} hasn't finished: once it has, re-run its "${GATE_JOB}" job.`
    )

    return
  }

  const {jobs} = Jobs.parse(
    JSON.parse(await api(`repos/${repo}/actions/runs/${run.id}/jobs`))
  )

  const gate = jobs.find(job => job.name === GATE_JOB)

  if (!gate) fail(`CI run ${run.id} has no "${GATE_JOB}" job.`)

  await $`gh api -X POST repos/${repo}/actions/jobs/${gate.id}/rerun`.quiet()
  console.log(`Re-running "${GATE_JOB}" on #${bump.number}.`)
}

const {values} = parseArgs({options: {pr: {type: 'string'}}})
const builds = liveBuilds()

const repo = (
  await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()
).trim()

const bump = await findBump(repo, values.pr ? Number(values.pr) : null)

if (bump) await checkedOut(bump)

const live = entriesOf(readText(LIST)).flatMap(entry =>
  liveCheckOf(entry) === entry.id ? [entry.id] : []
)

const result = {
  head: bump?.head ?? null,
  pinChanges: bump?.changes ?? [],
  checks: await runLiveChecks(live),
  reviews: await reviewAll(builds),
}

const body = renderResult(result)

console.log(`\n${body}`)

if (bump) {
  await $`gh pr comment ${bump.number} --body-file - < ${new Response(body)}`.cwd(
    root
  )
  await rerunGate(repo, bump)
} else {
  console.warn('No bump PR is open: there was nothing to comment on.')
}

process.exit(passed(result) ? 0 : 1)
